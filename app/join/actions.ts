"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";

// A teamless user asks to join an existing team. Creates (or re-opens) a
// pending join request keyed by team+user so it's idempotent. A leader on the
// target team approves it (see teams/[teamId]/members) before access is granted.
export async function requestToJoin(teamId: string) {
  const { uid, name, email, db } = await requireFirebaseUser();

  const teamSnap = await db.collection("teams").doc(teamId).get();
  if (!teamSnap.exists) throw new Error("Team not found");

  // Already a member? Nothing to request.
  const membership = await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .get();
  if (membership.exists) {
    revalidatePath("/join");
    return;
  }

  await db
    .collection("team_join_requests")
    .doc(`${teamId}__${uid}`)
    .set(
      {
        team_id: teamId,
        user_id: uid,
        requester_name: name ?? null,
        requester_email: email ?? null,
        status: "pending",
        created_at: FieldValue.serverTimestamp(),
        decided_at: null,
        decided_by: null,
      },
      { merge: true },
    );

  revalidatePath("/join");
}
