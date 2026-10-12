// Leader roster changes on one team (spec 2.2, 2.4): add an EXISTING directory
// person, remove a person. The cores take a db so tests can drive them with
// the fake; the server actions in app/(app)/directory/roster-actions.ts wrap
// them in requireTeamLeader. No account is ever created here (admin-only), and
// role changes are not here either (admin-only, admin/actions.ts).

import type { Firestore } from "firebase-admin/firestore";
import { syncUserTeamIds } from "./membership";
import { writeMembership } from "@/lib/team-invite";
import { stamp, stampBeforeDelete } from "@/lib/audit-stamp";
import { recordAccessChange } from "@/lib/access-audit";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Add `userId` to `teamId` as a member. They must be a live `users` profile. */
export async function addExistingPersonToTeam(
  db: Firestore,
  teamId: string,
  userId: string,
  actorUid: string,
): Promise<void> {
  if (!userId || typeof userId !== "string") {
    throw new Error("Choose a person from the directory");
  }
  const snap = await db.collection("users").doc(userId).get();
  if (!snap.exists) throw new Error("That person is not in the directory");
  const data = snap.data() ?? {};
  if (data.deactivated_at) throw new Error("That person is deactivated");

  const display = str(data.display_name);
  const [dFirst = "", ...dRest] = display.split(/\s+/).filter(Boolean);
  await writeMembership(db, {
    teamId,
    userId,
    role: "member",
    firstName: str(data.first_name) || dFirst,
    lastName: str(data.last_name) || dRest.join(" "),
    email: str(data.email),
    actorUid,
  });
  await recordAccessChange(db, {
    kind: "roster",
    actorUid,
    entityId: `${teamId}__${userId}`,
    teamId,
    targetUid: userId,
    before: { on_roster: false },
    after: { on_roster: true, role: "member" },
  });
}

/**
 * Remove `userId` from the team. The last leader cannot be removed (an admin
 * changes leaders first). Also drops the uid from the speaking order.
 */
export async function removePersonFromTeam(
  db: Firestore,
  team: { id: string; speakingOrder: string[] },
  userId: string,
  callerIsAdmin: boolean,
  actorUid: string,
): Promise<void> {
  const teamId = team.id;
  const memberRef = db.collection("team_members").doc(`${teamId}__${userId}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new Error("That person is not on this team");

  if (memberSnap.data()?.role === "leader") {
    // Removing a leader is a demotion: admin-only (spec 2.4).
    if (!callerIsAdmin) {
      throw new Error(
        "Only an admin can remove a leader; ask an admin to change leaders first",
      );
    }
    const roster = await db
      .collection("team_members")
      .where("team_id", "==", teamId)
      .get();
    const leaderCount = roster.docs.filter(
      (d) => d.data().role === "leader",
    ).length;
    if (leaderCount <= 1) {
      throw new Error(
        "A team needs at least one leader; ask an admin to change leaders first",
      );
    }
  }

  await stampBeforeDelete(memberRef, actorUid);
  const batch = db.batch();
  batch.delete(memberRef);
  if (team.speakingOrder.includes(userId)) {
    batch.update(db.collection("teams").doc(teamId), {
      speaking_order: team.speakingOrder.filter((id) => id !== userId),
      ...stamp(actorUid),
    });
  }
  await batch.commit();
  await syncUserTeamIds(db, userId, actorUid);
  await recordAccessChange(db, {
    kind: "roster",
    actorUid,
    entityId: memberRef.id,
    teamId,
    targetUid: userId,
    before: { on_roster: true, role: (memberSnap.data()?.role as string) ?? "member" },
    after: { on_roster: false },
  });
}
