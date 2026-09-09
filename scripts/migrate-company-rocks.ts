// Fold legacy `rock_type: "company"` rocks onto the two-flag model:
//   { rock_type: "department", is_company_rock: true }
//
// Before the Company flag existed, "company" was a third rock_type value that
// shared the Department section with "department". The app no longer writes
// it and the kind radio only offers individual / department; the Company half
// now lives in `is_company_rock`. Mapping to "department" keeps the Team pill
// those rocks showed (toFormRockType folded company → Team on read) and lets
// the Company > Department ladder promote them into the Company block.
//
// The app already reads a legacy doc correctly (isCompanyRock checks both
// shapes) and folds it forward on its next edit, so this is a tidy-up, not a
// prerequisite. Idempotent — a doc that is already migrated is skipped.
//
// Usage:
//   pnpm tsx scripts/migrate-company-rocks.ts                 # dry run
//   pnpm tsx scripts/migrate-company-rocks.ts --apply
//   pnpm tsx scripts/migrate-company-rocks.ts --database hpb-eos-prod-db --apply
//
// Dry-run by default (no --apply).

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";

type Args = { apply: boolean; database?: string };

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  const database = flags.get("database");
  return {
    apply: flags.has("apply"),
    database: typeof database === "string" ? database : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.database !== undefined) {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = args.database;
  }
  const db = getAdminDb();

  const snap = await db
    .collection("rocks")
    .where("rock_type", "==", "company")
    .get();

  console.log(
    `Legacy rock_type="company" rocks: ${snap.size}` +
      (args.database ? `  (database ${args.database})` : ""),
  );
  if (snap.size === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  for (const d of snap.docs) {
    const x = d.data();
    console.log(
      `  ${d.id}  team=${x.team_id}  "${String(x.title ?? "").slice(0, 60)}"` +
        `  → rock_type=department, is_company_rock=true`,
    );
  }

  if (!args.apply) {
    console.log("\nDry-run only. Re-run with --apply to write.");
    return;
  }

  // Firestore batches cap at 500 writes; chunk to stay under it.
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + CHUNK)) {
      batch.update(d.ref, { rock_type: "department", is_company_rock: true });
      written += 1;
    }
    await batch.commit();
  }
  console.log(`\n✓ Migrated ${written} rock${written === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
