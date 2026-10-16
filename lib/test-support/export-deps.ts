// Test seam for page export definitions (lib/export/pages/*.test.ts): run a
// page through the real core (lib/export/run.ts) against a FakeFirestore,
// as a signed-in, live account, at a fixed time and version. The viewer is
// built from the fake's roster, as lib/firebase/viewer.ts loadViewer builds
// it from the real one, so the page's own access rule and visibility
// predicate see the same teams and leader roles the page would.

import type { Firestore } from "firebase-admin/firestore";
import { viewerOf } from "@/lib/access/types";
import type { RunExportDeps } from "@/lib/export/run";
import type { FakeFirestore } from "./fake-firestore";

/** loadViewer's answer, from the fake's `team_members`. */
export async function rosterViewer(db: Firestore, uid: string, isAdmin: boolean) {
  const snap = await db.collection("team_members").where("user_id", "==", uid).get();
  const teams = snap.docs.map((d) => d.data().team_id as string);
  const leads = snap.docs
    .filter((d) => d.data().role === "leader")
    .map((d) => d.data().team_id as string);
  return viewerOf(uid, isAdmin, teams, leads);
}

/** Signed in as `uid` (live account), admin or not. */
export function exportDepsAs(
  db: FakeFirestore,
  who: { uid: string; isAdmin?: boolean; active?: boolean },
  extra: Partial<RunExportDeps> = {},
): RunExportDeps {
  return {
    user: async () => ({
      uid: who.uid,
      active: who.active ?? true,
      isAdmin: who.isAdmin ?? false,
      db: db.asFirestore(),
    }),
    db: () => db.asFirestore(),
    viewer: rosterViewer,
    now: () => new Date("2026-10-16T19:05:00Z"),
    env: { DEPLOYMENT_ID: "test-build" },
    ...extra,
  };
}

/** An org admin on no team. */
export function adminExportDeps(
  db: FakeFirestore,
  extra: Partial<RunExportDeps> = {},
): RunExportDeps {
  return exportDepsAs(db, { uid: "admin", isAdmin: true }, extra);
}

/** Every audit_log row the fake holds. */
export function auditRowsOf(db: FakeFirestore): Record<string, unknown>[] {
  return db.docsIn("audit_log").map((d) => d.data as Record<string, unknown>);
}

/** A Timestamp-shaped value, as the admin SDK hands back. */
export const ts = (iso: string) => ({
  toMillis: () => Date.parse(iso),
  toDate: () => new Date(iso),
});
