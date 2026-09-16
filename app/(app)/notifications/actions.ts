"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";

/**
 * Mark one of the caller's notifications read. A row belonging to someone
 * else is treated as not found rather than forbidden, so ids stay
 * unenumerable — the same posture requireTeamDoc takes.
 */
export async function markNotificationRead(id: string) {
  const { uid, db } = await requireFirebaseUser();
  const ref = db.collection("notifications").doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.user_id !== uid) return;
  if (snap.data()?.read_at != null) return;
  await ref.update({ read_at: FieldValue.serverTimestamp() });
  revalidatePath("/notifications");
}

/** Mark everything unread for the caller as read, in one batch. */
export async function markAllNotificationsRead() {
  const { uid, db } = await requireFirebaseUser();
  const snap = await db
    .collection("notifications")
    .where("user_id", "==", uid)
    .where("read_at", "==", null)
    .get();
  if (snap.empty) return 0;
  // Batches cap at 500 writes; chunk in case a long-idle inbox exceeds it.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) {
      batch.update(d.ref, { read_at: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  revalidatePath("/notifications");
  return docs.length;
}
