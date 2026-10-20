// Who may open the feedback tracker (ROADMAP N73; Daniel, 2026-10-19).
//
// Every org admin gets in; this script keeps the list that lets non-admins
// in too: the emails in `app_config/feedback_tracker.emails`. Everyone who
// gets in sees and edit everything in the tracker. The app reads
// the list on every tracker request (lib/firebase/feedback-access.ts), so a
// change here takes effect on the person's next page load — no deploy.
//
// Usage (dry-run unless --apply; sandbox first, always):
//   pnpm feedback:access -- --target sandbox --list
//   pnpm feedback:access -- --target sandbox --add steph@example.com --add joe@example.com
//   pnpm feedback:access -- --target sandbox --add steph@example.com --apply --actor <uid>
//   pnpm feedback:access -- --target prod --remove someone@example.com --apply --actor <uid>
//
// --add / --remove are repeatable; emails are trimmed and lowercased and must
// look like an email. A dry run prints the list before and after. --apply
// writes it in a transaction with updated_at and updated_by (--actor <uid>,
// the operator's own Auth uid; "system" without it).
//
// A target is required — `--target sandbox|prod` (scripts/lib/target.ts;
// prod uses Application Default Credentials) or `--env-file <path>`.
// No email is kept in code: the list lives only in the database.

import { target } from "./lib/load-target-explicit"; // first: sets up env before anything reads it
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";
import { SYSTEM_ACTOR_ID } from "../lib/activity";
import {
  FEEDBACK_ACCESS_COLLECTION,
  FEEDBACK_ACCESS_DOC_ID,
  applyAccessChanges,
  parseAccessArgs,
  readAccessEmails,
  type AccessArgs,
} from "../lib/feedback/access";

function show(label: string, emails: readonly string[]) {
  console.log(`  ${label} (${emails.length}):`);
  if (emails.length === 0) console.log("    (empty — nobody can open the tracker)");
  for (const e of emails) console.log(`    ${e}`);
}

async function main() {
  let args: AccessArgs;
  try {
    args = parseAccessArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset project)";
  const database = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "(default)";
  const changing = args.add.length > 0 || args.remove.length > 0;
  const actor = args.actor ?? SYSTEM_ACTOR_ID;

  console.log(
    `\nFeedback tracker access list` +
      `\n  target:    ${target.target ?? `--env-file ${target.envFile}`}` +
      `\n  project:   ${project}` +
      `\n  database:  ${database}` +
      `\n  doc:       ${FEEDBACK_ACCESS_COLLECTION}/${FEEDBACK_ACCESS_DOC_ID}` +
      (changing
        ? `\n  actor:     ${actor}` +
          `\n  mode:      ${args.apply ? "APPLY — writes" : "dry-run (pass --apply to write)"}`
        : "") +
      "\n",
  );

  const db = getAdminDb();
  const ref = db.collection(FEEDBACK_ACCESS_COLLECTION).doc(FEEDBACK_ACCESS_DOC_ID);
  const snap = await ref.get();
  const before = snap.exists ? readAccessEmails(snap.data()) : [];
  if (!snap.exists) console.log("  (no access doc yet)");

  if (!changing) {
    show("current list", before);
    return;
  }

  const after = applyAccessChanges(before, args.add, args.remove);
  show("before", before);
  show("after", after);
  for (const e of args.remove) if (!before.includes(e)) console.log(`  note: ${e} was not on the list`);
  for (const e of args.add) if (before.includes(e)) console.log(`  note: ${e} was already on the list`);

  if (!args.apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  // Re-read inside the transaction so a concurrent change is not lost.
  const written = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const list = applyAccessChanges(
      cur.exists ? readAccessEmails(cur.data()) : [],
      args.add,
      args.remove,
    );
    tx.set(ref, { emails: list, updated_at: FieldValue.serverTimestamp(), updated_by: actor });
    return list;
  });
  console.log(`\n✓ Wrote ${written.length} email(s) to ${FEEDBACK_ACCESS_COLLECTION}/${FEEDBACK_ACCESS_DOC_ID}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
