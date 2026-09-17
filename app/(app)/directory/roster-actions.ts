"use server";

// Roster changes on one team: add, remove, promote/demote. Leader-or-admin,
// enforced by requireTeamLeader. These used to live under the team Members
// page; the Directory is the only roster surface now.

import { revalidatePath } from "next/cache";
import { getAdminAuth } from "@/lib/firebase/admin";
import {
  getTeamMembers,
  requireTeamLeader,
} from "@/lib/firebase/teams";
import {
  assertInviteEmail,
  ensureAuthUser,
  writeMembership,
} from "@/lib/team-invite";

// Leader-initiated add: create (or reuse) a Firebase Auth account for the
// given email, hydrate /users/{uid}, and write team_members. Mirrors the
// create-accounts CLI + admin create-team path so the person can sign in with
// Google later and land on this team with their name already set.
//
// Creating an Auth record does NOT email anyone — it's an empty account
// waiting for first Google sign-in (same as pnpm accounts:create).
export async function addTeamMember(teamId: string, formData: FormData) {
  const { db } = await requireTeamLeader(teamId);

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "");

  if (!firstName) throw new Error("First name is required");
  if (!lastName) throw new Error("Last name is required");
  const email = assertInviteEmail(emailRaw);

  const auth = getAdminAuth();
  const userId = await ensureAuthUser(auth, {
    email,
    firstName,
    lastName,
  });

  await writeMembership(db, {
    teamId,
    userId,
    role: "member",
    firstName,
    lastName,
    email,
  });

  revalidatePath("/directory");
}

// Remove someone from the roster. Their rocks, to-dos, and issues stay on
// the team (their name keeps rendering via /users — never deleted here);
// they just lose access. Leaders only (or org admin). The last leader can't
// be removed — promote a replacement first. Also drops the uid from the
// team's speaking order and clears meeting driver if it pointed at them.
export async function removeTeamMember(teamId: string, userId: string) {
  const { db, team } = await requireTeamLeader(teamId);

  const memberRef = db.collection("team_members").doc(`${teamId}__${userId}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new Error("That person is not on this team");

  if (memberSnap.data()?.role === "leader") {
    // Count leaders in code rather than a two-equality query (no composite
    // index needed; rosters are small).
    const roster = await db
      .collection("team_members")
      .where("team_id", "==", teamId)
      .get();
    const leaderCount = roster.docs.filter(
      (d) => d.data().role === "leader",
    ).length;
    if (leaderCount <= 1) {
      throw new Error(
        "Promote another leader before removing the last one",
      );
    }
  }

  const batch = db.batch();
  batch.delete(memberRef);

  const teamUpdate: Record<string, unknown> = {};
  if (team.speakingOrder.includes(userId)) {
    teamUpdate.speaking_order = team.speakingOrder.filter(
      (id) => id !== userId,
    );
  }
  if (Object.keys(teamUpdate).length > 0) {
    batch.update(db.collection("teams").doc(teamId), teamUpdate);
  }

  await batch.commit();

  revalidatePath("/directory");
}

/**
 * Promote a member to leader, or demote a leader to member.
 * Team leaders or org admins. A team must keep at least one leader — demoting
 * the last leader (including yourself) is rejected so the team can't lock
 * itself out of roster management.
 */
export async function setMemberRole(
  teamId: string,
  userId: string,
  role: "leader" | "member",
) {
  if (role !== "leader" && role !== "member") {
    throw new Error("Role must be leader or member");
  }

  const { db } = await requireTeamLeader(teamId);

  const memberRef = db.collection("team_members").doc(`${teamId}__${userId}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists || memberSnap.data()?.team_id !== teamId) {
    throw new Error("That person is not on this team");
  }

  const currentRole = (memberSnap.data()?.role as string) ?? "member";
  if (currentRole === role) {
    revalidatePath("/directory");
    return;
  }

  if (role === "member" && currentRole === "leader") {
    const members = await getTeamMembers(teamId);
    const leaderCount = members.filter((m) => m.role === "leader").length;
    if (leaderCount <= 1) {
      throw new Error(
        "This team needs at least one leader. Promote someone else first.",
      );
    }
  }

  await memberRef.set(
    {
      team_id: teamId,
      user_id: userId,
      role,
    },
    { merge: true },
  );
  revalidatePath("/directory");
}
