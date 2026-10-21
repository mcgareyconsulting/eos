// Read-only diagnostic: prints the document count of each named top-level
// collection in one Firestore database, as JSON on stdout.
//
// Built as a companion to `scripts/restore-test.sh`, which needs
// per-collection counts on both the source database and a freshly restored
// target database — something `gcloud firestore` has no built-in command
// for, so this uses the Admin SDK's `.count()` aggregation query instead
// (a server-side count, not a full document read).
//
// Usage:
//   pnpm tsx scripts/restore-test-count.ts --target prod \
//     --collections organizations,users,teams
//   pnpm tsx scripts/restore-test-count.ts --project hpb-eos-prod \
//     --database hpb-eos-restore-test-123 --collections organizations,users,teams
//
// Flags:
//   --target sandbox|prod  Named database (scripts/lib/target.ts); replaces
//                          --project/--database
//   --project <id>         GCP project (required without --target)
//   --database <id>        Firestore database id (required without --target)
//   --collections <csv>    Comma-separated top-level collection names (required)
//
// restore-test.sh calls this with --project/--database (its throwaway restore
// database has no named target).
//
// Touches nothing — every call is `.count()`, never a write. Output is a
// single JSON object so callers (restore-test.sh) can parse it without
// scraping text:
//   {"project":"...","database":"...","counts":{"col":123,...}}

import { target } from "./lib/load-target"; // first: sets up env before anything reads it
import { getAdminDb } from "../lib/firebase/admin";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

async function main() {
  // --target already set both env vars (and refuses --project/--database).
  const project = target.target ? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID : arg("project");
  const database = target.target ? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID : arg("database");
  const collectionsCsv = arg("collections");

  if (!project || !database || !collectionsCsv) {
    console.error(
      "Usage: pnpm tsx scripts/restore-test-count.ts (--target sandbox|prod | --project <id> --database <id>) --collections <csv>",
    );
    process.exit(1);
  }

  // Mirrors delete-team.ts / team-info.ts: these env vars are what
  // lib/firebase/admin.ts reads to pick project + database, and ADC
  // (`gcloud auth application-default login`) supplies credentials.
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = project;
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = database;

  const collections = collectionsCsv.split(",").map((c) => c.trim()).filter(Boolean);
  const db = getAdminDb();

  const counts: Record<string, number> = {};
  for (const col of collections) {
    const snap = await db.collection(col).count().get();
    counts[col] = snap.data().count;
  }

  console.log(JSON.stringify({ project, database, counts }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: (err as Error).message }));
  process.exit(1);
});
