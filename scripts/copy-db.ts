// Copies every document (all collections, all subcollections) from one
// Firestore database to another in the same project. Built for refreshing
// the sandbox database from the live one:
//
//   pnpm db:copy --from hpb-eos-prod-db --to hpb-eos-sandbox-db
//   pnpm db:copy --from hpb-eos-prod-db --to hpb-eos-sandbox-db --dry-run
//
// Existing destination docs with the same path are overwritten; docs that
// exist only in the destination are left alone (this is a copy, not a sync —
// wipe the destination with `pnpm team:delete` first if you want a clean
// mirror).
//
// The destination must contain "sandbox" in its id. That's a hard rule, not
// a flag: the only database anyone would point --to by mistake is the live
// one, and there is no legitimate reason to bulk-overwrite it from a script.

import { pathToFileURL } from "node:url";
import { config } from "dotenv";
config({ path: ".env.local" });

import { getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function copyCollection(
  src: CollectionReference,
  dstDb: Firestore,
  dryRun: boolean,
  stats: { docs: number },
): Promise<void> {
  // listDocuments (not .get()) so "phantom" parents — deleted docs whose
  // subcollections still hold data — are traversed too; .get() skips them
  // and would silently drop everything underneath.
  const refs = await src.listDocuments();
  for (const ref of refs) {
    const snap = await ref.get();
    const dstRef = dstDb.doc(ref.path) as DocumentReference;
    if (snap.exists) {
      stats.docs++;
      if (!dryRun) await dstRef.set(snap.data()!);
    }
    for (const sub of await ref.listCollections()) {
      await copyCollection(sub, dstDb, dryRun, stats);
    }
  }
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  const dryRun = process.argv.includes("--dry-run");

  if (!from || !to) {
    console.error("Usage: pnpm db:copy --from <db-id> --to <db-id> [--dry-run]");
    process.exit(1);
  }
  if (from === to) {
    console.error("--from and --to are the same database.");
    process.exit(1);
  }
  if (!/sandbox/.test(to)) {
    console.error(
      `Refusing: destination "${to}" is not a sandbox database. ` +
        "This script only writes into databases with 'sandbox' in the id.",
    );
    process.exit(1);
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!getApps().length) initializeApp({ projectId });
  const srcDb = getFirestore(from);
  const dstDb = getFirestore(to);

  console.log(
    `Copying ${projectId}/${from} -> ${projectId}/${to}` +
      `${dryRun ? "   [DRY RUN — counting only]" : ""}\n`,
  );

  const stats = { docs: 0 };
  for (const col of await srcDb.listCollections()) {
    const before = stats.docs;
    await copyCollection(col, dstDb, dryRun, stats);
    console.log(`  ${col.id}: ${stats.docs - before} docs`);
  }

  console.log(`\n${dryRun ? "Would copy" : "Copied"} ${stats.docs} documents.`);
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
