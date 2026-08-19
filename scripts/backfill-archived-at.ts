// F4 — stamp `archived_at: null` on todos / issues / headlines that were
// imported before 2026-08-04 without the field. Firestore `== null` does
// not match a missing field, so the Monday sweep skips those docs until
// this runs.
//
// Dry-run by default. Does not un-archive anything: docs that already have
// a timestamp keep it.
//
// Usage:
//   pnpm tsx scripts/backfill-archived-at.ts
//   pnpm tsx scripts/backfill-archived-at.ts --apply
//
// Targets whatever `.env.local` points at (same as seed / import). Confirm
// the printed project + database before --apply.

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";

const COLLECTIONS = ["todos", "issues", "headlines"] as const;
const BATCH_SIZE = 400;

function missingArchivedAt(data: Record<string, unknown>): boolean {
  return !Object.prototype.hasOwnProperty.call(data, "archived_at");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const project =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset project)";
  const database =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "(default)";
  const db = getAdminDb();

  console.log(
    `\nF4 archived_at backfill  project=${project}  database=${database}  mode=${apply ? "APPLY" : "dry-run"}\n`,
  );

  let totalMissing = 0;
  let totalWritten = 0;

  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get();
    const missing = snap.docs.filter((d) =>
      missingArchivedAt(d.data() as Record<string, unknown>),
    );
    totalMissing += missing.length;
    console.log(
      `  ${col}: ${snap.size} docs, ${missing.length} missing archived_at`,
    );
    if (!apply || missing.length === 0) continue;

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const chunk = missing.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const d of chunk) {
        batch.update(d.ref, { archived_at: null });
      }
      await batch.commit();
      totalWritten += chunk.length;
    }
  }

  console.log(
    apply
      ? `\nWrote archived_at: null on ${totalWritten} doc(s).`
      : `\n${totalMissing} doc(s) would be stamped. Re-run with --apply to write.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
