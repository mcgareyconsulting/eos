// Backfill issues/{id}.comment_count from entity_comments (feedback row 35).
//
// The Issues page and the L10 Issues segment show a comment counter on each
// issue row (lib/issue-comment-count.ts). The comment actions keep it
// current from the day it shipped; issues commented on before that have no
// field and show no badge until this recounts them. It recounts every issue,
// so it is safe to re-run at any time, and it also repairs any drift.
//
// Dry-run by default: prints every issue whose stored count would change
// (before → after). Pass --apply to write.
//
// Usage (dry-run first, always):
//   pnpm issues:backfill-comment-counts -- --env-file .env.local           # sandbox, dry-run
//   pnpm issues:backfill-comment-counts -- --env-file .env.prod            # LIVE, dry-run
//   pnpm issues:backfill-comment-counts -- --env-file .env.prod --apply
//
// `--env-file` is required: there is no default target, so the database is
// always one you named (`.env.local` points at the SANDBOX database). The
// env file, project and database are printed before anything is written;
// read them before adding --apply.
//
// Each write recounts its issue's thread inside a transaction, so a comment
// posted or deleted between the dry-run read and the write is not lost.
// Writes only `comment_count` — no audit stamp, since no person made the
// change (the audit row's actor is null, as for every operator script).

import { config } from "dotenv";

const envFlag = process.argv.indexOf("--env-file");
const envFile = envFlag === -1 ? undefined : process.argv[envFlag + 1];
if (!envFile || envFile.startsWith("--")) {
  console.error(
    "--env-file is required, e.g. --env-file .env.local (sandbox) or --env-file .env.prod (live)",
  );
  process.exit(1);
}
config({ path: envFile });

import { getAdminDb } from "../lib/firebase/admin";
import {
  ISSUE_COMMENT_COUNT_FIELD,
  planCommentCountBackfill,
} from "../lib/issue-comment-count";

async function main() {
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const project =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset project)";
  const database =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "(default)";
  const db = getAdminDb();

  console.log(
    `\nIssue comment_count backfill` +
      `\n  env file:  ${envFile}` +
      `\n  project:   ${project}` +
      `\n  database:  ${database}` +
      `\n  mode:      ${apply ? "APPLY — writes" : "dry-run (pass --apply to write)"}\n`,
  );

  const [issuesSnap, commentsSnap] = await Promise.all([
    db.collection("issues").get(),
    db.collection("entity_comments").where("entity_type", "==", "issue").get(),
  ]);
  const { writes, unchanged, orphans } = planCommentCountBackfill(
    issuesSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
    commentsSnap.docs.map((d) => d.data()),
  );

  for (const w of writes) {
    console.log(`  write  issues/${w.issueId}  ${String(w.before ?? "(unset)")} → ${w.after}`);
  }
  if (verbose && unchanged > 0) console.log(`  (${unchanged} already correct)`);

  console.log(
    `\n${issuesSnap.size} issue(s), ${commentsSnap.size} issue comment(s): ` +
      `${writes.length} to write, ${unchanged} already correct, ` +
      `${orphans} comment(s) on issues that no longer exist (not written).`,
  );

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const w of writes) {
    const issueRef = db.collection("issues").doc(w.issueId);
    // entity_id alone (as lib/firebase/purge.ts reads threads), so no
    // composite index is needed; the type is checked in code.
    const threadQuery = db
      .collection("entity_comments")
      .where("entity_id", "==", w.issueId);
    await db.runTransaction(async (tx) => {
      const [issue, thread] = await Promise.all([tx.get(issueRef), tx.get(threadQuery)]);
      if (!issue.exists) return;
      const n = thread.docs.filter((d) => d.data().entity_type === "issue").length;
      tx.update(issueRef, { [ISSUE_COMMENT_COUNT_FIELD]: n });
    });
    written++;
  }
  console.log(`\n✓ Recounted comment_count on ${written} issue(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
