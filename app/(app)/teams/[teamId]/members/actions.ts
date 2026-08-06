"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { isEmailAllowed, parseAllowlist } from "@/lib/auth-allowlist";
import { getAdminAuth } from "@/lib/firebase/admin";
import {
  getTeamMembers,
  requireTeamLeader,
} from "@/lib/firebase/teams";

function pathFor(teamId: string) {
  return `/teams/${teamId}/members`;
}

/**
 * Durable L10 speaking order on the team (P1-5). Leaders only.
 * Must be a full permutation of the current roster.
 */
export async function setTeamSpeakingOrder(teamId: string, uids: string[]) {
  const { db } = await requireTeamLeader(teamId);
  const members = await getTeamMembers(teamId);
  const memberIds = new Set(members.map((m) => m.user_id));
  const unique = new Set(uids);
  const isPermutation =
    uids.length === members.length &&
    unique.size === uids.length &&
    uids.every((uid) => memberIds.has(uid));
  if (!isPermutation) throw new Error("Invalid speaking order");

  await db.collection("teams").doc(teamId).update({ speaking_order: uids });
  revalidatePath(pathFor(teamId));
}

// Loose but practical address check. We normalize to lowercase before use;
// the allowlist (when set) is the real perimeter gate.
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Leader-initiated add: create (or reuse) a Firebase Auth account for the
// given email, hydrate /users/{uid}, and write team_members. Mirrors the
// create-accounts CLI + join-approval path so the person can sign in with
// Google later and land on this team with their name already set.
//
// Creating an Auth record does NOT email anyone — it's an empty account
// waiting for first Google sign-in (same as pnpm accounts:create).
export async function addTeamMember(teamId: string, formData: FormData) {
  const { uid: leaderUid, db } = await requireTeamLeader(teamId);

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!firstName) throw new Error("First name is required");
  if (!lastName) throw new Error("Last name is required");
  if (!email || !isValidEmail(email)) {
    throw new Error("Enter a valid email address");
  }

  // Don't let leaders pre-stage accounts that the sign-in perimeter will
  // reject. When allowlist is unset (open trial), any address is fine.
  const allowlist = parseAllowlist(process.env.SIGN_IN_ALLOWLIST);
  if (!isEmailAllowed(allowlist, email)) {
    throw new Error(
      "That email isn't on the sign-in allowlist for this app. Use a High Plains Bank address.",
    );
  }

  const auth = getAdminAuth();
  let userId: string;
  const existing = await auth.getUserByEmail(email).catch(() => null);
  if (existing) {
    userId = existing.uid;
  } else {
    const created = await auth.createUser({
      email,
      displayName: `${firstName} ${lastName}`,
      // emailVerified stays false — nothing here verifies the address;
      // Google sets it on first sign-in.
    });
    userId = created.uid;
  }

  // Already on this team? Surface a clear error instead of silently no-op'ing.
  const memberRef = db.collection("team_members").doc(`${teamId}__${userId}`);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    throw new Error("That person is already on this team");
  }

  const fullName = `${firstName} ${lastName}`.trim();
  const batch = db.batch();

  batch.set(
    db.collection("users").doc(userId),
    {
      display_name: fullName,
      first_name: firstName,
      last_name: lastName,
      email,
    },
    { merge: true },
  );

  batch.set(memberRef, {
    team_id: teamId,
    user_id: userId,
    role: "member",
    created_at: FieldValue.serverTimestamp(),
  });

  // If they had a pending join request for this team, close it as approved
  // so it doesn't linger under Pending requests.
  const requestRef = db
    .collection("team_join_requests")
    .doc(`${teamId}__${userId}`);
  const requestSnap = await requestRef.get();
  if (requestSnap.exists && requestSnap.data()?.status === "pending") {
    batch.update(requestRef, {
      status: "approved",
      decided_at: FieldValue.serverTimestamp(),
      decided_by: leaderUid,
    });
  }

  await batch.commit();
  revalidatePath(pathFor(teamId));
}

// Approve a pending join request: write the user's profile + team membership,
// then mark the request approved. Leaders only. Idempotent — re-approving an
// already-decided request is a no-op.
export async function approveJoinRequest(teamId: string, userId: string) {
  const { uid: leaderUid, db } = await requireTeamLeader(teamId);

  const requestRef = db
    .collection("team_join_requests")
    .doc(`${teamId}__${userId}`);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists || requestSnap.data()?.status !== "pending") {
    revalidatePath(pathFor(teamId));
    return;
  }

  const req = requestSnap.data() ?? {};
  const fullName = String(req.requester_name ?? "").trim();
  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(" ");

  const batch = db.batch();

  // Hydrate the /users profile so the member's name renders everywhere.
  batch.set(
    db.collection("users").doc(userId),
    {
      display_name: fullName || null,
      first_name: firstName ?? null,
      last_name: lastName || null,
      email: req.requester_email ?? null,
    },
    { merge: true },
  );

  batch.set(db.collection("team_members").doc(`${teamId}__${userId}`), {
    team_id: teamId,
    user_id: userId,
    role: "member",
    created_at: FieldValue.serverTimestamp(),
  });

  batch.update(requestRef, {
    status: "approved",
    decided_at: FieldValue.serverTimestamp(),
    decided_by: leaderUid,
  });

  await batch.commit();
  revalidatePath(pathFor(teamId));
}

// Designate (or clear) the member who drives the live L10. Label-only — this
// does not restrict who can advance the stage; it just marks the facilitator.
// An empty/"none" value clears the designation. Leaders only. We verify the
// chosen user is actually a member of this team before writing.
export async function setMeetingDriver(teamId: string, formData: FormData) {
  const { db } = await requireTeamLeader(teamId);
  const raw = String(formData.get("driver_id") ?? "").trim();
  const driverId = raw && raw !== "none" ? raw : null;

  if (driverId) {
    const member = await db
      .collection("team_members")
      .doc(`${teamId}__${driverId}`)
      .get();
    if (!member.exists) throw new Error("Driver must be a team member");
  }

  await db
    .collection("teams")
    .doc(teamId)
    .set({ meeting_driver_id: driverId }, { merge: true });
  revalidatePath(pathFor(teamId));
}

// Save the team's standing Google Meet URL used by the live-meeting Join
// button. DEMO: a leader pastes a Meet link here. In the real integration this
// is where the Meet REST API `spaces.create` would mint a per-meeting link at
// meeting start instead of a fixed team-level URL. Leaders only.
export async function setMeetLink(teamId: string, formData: FormData) {
  const { db } = await requireTeamLeader(teamId);
  const raw = String(formData.get("meet_link") ?? "").trim();

  // Accept a Meet URL or a blank (to clear). Reject anything that isn't a
  // Google Meet link so the Join button can't be pointed at arbitrary hosts.
  let meetLink: string | null = null;
  if (raw) {
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      throw new Error("Enter a valid URL");
    }
    if (host !== "meet.google.com") {
      throw new Error("Link must be a meet.google.com URL");
    }
    meetLink = raw;
  }

  await db
    .collection("teams")
    .doc(teamId)
    .set({ meet_link: meetLink }, { merge: true });
  revalidatePath(pathFor(teamId));
}

export async function denyJoinRequest(teamId: string, userId: string) {
  const { uid: leaderUid, db } = await requireTeamLeader(teamId);

  const requestRef = db
    .collection("team_join_requests")
    .doc(`${teamId}__${userId}`);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists || requestSnap.data()?.status !== "pending") {
    revalidatePath(pathFor(teamId));
    return;
  }

  await requestRef.update({
    status: "denied",
    decided_at: FieldValue.serverTimestamp(),
    decided_by: leaderUid,
  });
  revalidatePath(pathFor(teamId));
}

/**
 * Promote a member to leader, or demote a leader to member.
 * Leaders only. A team must keep at least one leader — demoting the last
 * leader (including yourself) is rejected so the team can't lock itself out
 * of Members admin.
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
    revalidatePath(pathFor(teamId));
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
  revalidatePath(pathFor(teamId));
}
