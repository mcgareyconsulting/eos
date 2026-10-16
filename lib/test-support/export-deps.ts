// Test seam for page export definitions (lib/export/pages/*.test.ts): run a
// page through the real core (lib/export/run.ts) against a FakeFirestore,
// as a signed-in admin, at a fixed time and version.

import { viewerOf } from "@/lib/access/types";
import type { RunExportDeps } from "@/lib/export/run";
import type { FakeFirestore } from "./fake-firestore";

export function adminExportDeps(
  db: FakeFirestore,
  extra: Partial<RunExportDeps> = {},
): RunExportDeps {
  return {
    user: async () => ({
      uid: "admin",
      email: "admin@highplainsbank.com",
      name: "Org Admin",
      isAdmin: true,
      db: db.asFirestore(),
    }),
    viewer: async (_db, uid, isAdmin) => viewerOf(uid, isAdmin, [], []),
    now: () => new Date("2026-10-16T19:05:00Z"),
    env: { DEPLOYMENT_ID: "test-build" },
    ...extra,
  };
}

/** A Timestamp-shaped value, as the admin SDK hands back. */
export const ts = (iso: string) => ({
  toMillis: () => Date.parse(iso),
  toDate: () => new Date(iso),
});
