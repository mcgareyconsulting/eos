import { cache } from "react";
import type { Firestore } from "firebase-admin/firestore";
import { viewerOf, type Viewer } from "@/lib/access/types";
import { requireFirebaseUser } from "./auth";

/**
 * The access `Viewer` (lib/access/types.ts) for `uid`: every team they are
 * rostered on and the ones they lead, from `team_members`.
 */
export async function loadViewer(
  db: Firestore,
  uid: string,
  isAdmin: boolean,
): Promise<Viewer> {
  const snap = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .get();
  const teams: string[] = [];
  const leads: string[] = [];
  for (const d of snap.docs) {
    const tid = d.data().team_id as string | undefined;
    if (!tid) continue;
    teams.push(tid);
    if (d.data().role === "leader") leads.push(tid);
  }
  return viewerOf(uid, isAdmin, teams, leads);
}

/** The signed-in user as a Viewer. Per-request cached. */
export const requireViewer = cache(async () => {
  const { uid, isAdmin, db } = await requireFirebaseUser();
  return { uid, isAdmin, db, viewer: await loadViewer(db, uid, isAdmin) };
});
