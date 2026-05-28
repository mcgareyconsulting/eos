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
