// Import the HPB feedback spreadsheet into the feedback tracker (ROADMAP N73).
//
// Reads docs/feedback/feedback-tracker-seed.json (59 records), maps each to a
// `feedback_items/fb-NNN` doc (lib/feedback/seed.ts — same validators as the
// app's own writes), and creates the ones that are not there yet.
// Create-if-absent: an item already in the database is never overwritten, so
// edits made in the app win and the import is safe to re-run.
//
// Dry-run by default: prints create / skip (already there) / invalid counts
// and every invalid record. Pass --apply to write.
//
// Usage (dry-run first, always):
//   pnpm feedback:import -- --target sandbox                      # sandbox, dry-run
//   pnpm feedback:import -- --target sandbox --apply
//   pnpm feedback:import -- --target prod                         # LIVE, dry-run
//   pnpm feedback:import -- --target prod --apply --actor <uid>
//
// A target is required — `--target sandbox|prod` (see scripts/lib/target.ts;
// prod uses Application Default Credentials) or `--env-file <path>`.
//
// Each created item gets one `activity` row, kind "imported", in the same
// transaction. Actor: `--actor <uid>` (the operator's own Auth uid) names
// them on the activity row and as the item's C-07 stamp, so the audit row is
// attributed. Without it the row's actor is "system" and the item carries
// no stamp — the audit row's actor is null, as for every other operator
// script.
//
// Screenshots are recorded by basename (row02.png); the image files stay in
// docs/feedback/screenshots — this script uploads nothing.

import { target } from "./lib/load-target-explicit"; // first: sets up env before anything reads it
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";
import { stamp } from "../lib/audit-stamp";
import { SYSTEM_ACTOR_ID } from "../lib/activity";
import { feedbackCreateActivity } from "../lib/feedback/model";
import { planSeedImport, type FeedbackSeedRecord } from "../lib/feedback/seed";
import { FEEDBACK_ACTIVITY_COLLECTION, FEEDBACK_COLLECTION } from "../lib/feedback/types";

const SEED_PATH = "docs/feedback/feedback-tracker-seed.json";

function flagValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${flag} needs a value.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const actor = flagValue("--actor");
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset project)";
  const database = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "(default)";
  const db = getAdminDb();

  console.log(
    `\nFeedback tracker seed import` +
      `\n  target:    ${target.target ?? `--env-file ${target.envFile}`}` +
      `\n  project:   ${project}` +
      `\n  database:  ${database}` +
      `\n  seed:      ${SEED_PATH}` +
      `\n  actor:     ${actor ?? `${SYSTEM_ACTOR_ID} (no stamp; pass --actor <uid> to attribute)`}` +
      `\n  mode:      ${apply ? "APPLY — writes" : "dry-run (pass --apply to write)"}\n`,
  );

  const records = JSON.parse(readFileSync(resolve(SEED_PATH), "utf8")) as FeedbackSeedRecord[];
  if (!Array.isArray(records)) throw new Error(`${SEED_PATH} is not a JSON array`);

  const existing = await db.collection(FEEDBACK_COLLECTION).get();
  const plan = planSeedImport(records, new Set(existing.docs.map((d) => d.id)));

  for (const bad of plan.invalid) console.log(`  invalid  ${bad.label}: ${bad.error}`);
  if (plan.skip.length > 0) console.log(`  skip (already in the database): ${plan.skip.join(", ")}`);
  console.log(
    `\n${records.length} seed record(s): create ${plan.create.length} / ` +
      `skip ${plan.skip.length} existing / invalid ${plan.invalid.length}.`,
  );

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  const col = db.collection(FEEDBACK_COLLECTION);
  let created = 0;
  let raced = 0;
  for (const { id, item } of plan.create) {
    const ref = col.doc(id);
    const wrote = await db.runTransaction(async (tx) => {
      // Re-checked in the transaction: an item logged in the app since the
      // plan was read is left alone.
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, {
        ...item,
        created_at: FieldValue.serverTimestamp(),
        ...(actor ? stamp(actor) : { updated_at: FieldValue.serverTimestamp() }),
      });
      tx.set(ref.collection(FEEDBACK_ACTIVITY_COLLECTION).doc(), {
        ...feedbackCreateActivity("imported", actor ?? SYSTEM_ACTOR_ID, item.status),
        at: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (wrote) created++;
    else raced++;
  }
  console.log(
    `\n✓ Created ${created} feedback item(s)` +
      (raced > 0 ? `; ${raced} appeared since the dry-run read and were left alone.` : "."),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
