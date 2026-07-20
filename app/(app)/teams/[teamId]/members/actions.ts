"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamLeader } from "@/lib/firebase/teams";

function pathFor(teamId: string) {
  return `/teams/${teamId}/members`;
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
