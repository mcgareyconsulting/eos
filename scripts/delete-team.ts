// Deletes a team and everything scoped to it. Destructive and irreversible —
// dry-run is the default, and applying requires --yes.
//
// The counterpart to `import-csv.ts`: an import that landed on the wrong team,
// or a demo team that's outlived its usefulness, needs a way out.
//
// Usage:
//   pnpm team:delete --team "Demo Team" [--project hpb-eos --database ""]
//   pnpm team:delete --team "Demo Team" --yes
//
// Options:
//   --team <name|id>   Team to delete. Matched by doc id first, then by name. [required]
//   --yes              Actually delete. Without it, this only reports.
//   --project <id>     Firestore project, overriding .env.local.
//   --database <id>    Firestore database id ("" for the default database).
//   --prune-users      Also delete /users docs for synthetic members (demo-*,
//                      import-*) left on no other team. Real accounts are never
//                      touched.
//
// Leaves alone: audit_log (it's the record of what happened), /users docs for
// real accounts, and every other team.

import { config } from "dotenv";
config({ path: ".env.local" });

import type { DocumentReference, Firestore, Query } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";

// Collections carrying a team_id. Children keyed by a parent id instead
// (scorecard_entries → metric_id, issue_votes → issue_id) are handled below,
// and meetings' subcollections come along via recursiveDelete.
const TEAM_SCOPED = [
  "rocks",
  "rock_status_updates",
  "todos",
  "issues",
  "entity_comments",
  "headlines",
  "scorecard_metrics",
  "meetings",
  "team_members",
  "team_join_requests",
] as const;

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    const value: string | true = next !== undefined && !next.startsWith("--") ? next : true;
    flags.set(argv[i].slice(2), value);
    if (typeof value === "string") i++;
  }
  const str = (k: string) => {
    const v = flags.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const team = str("team");
  if (!team) {
    console.error('Usage: pnpm team:delete --team "Demo Team" [--yes]');
    process.exit(1);
  }
  return {
    team,
    apply: flags.has("yes"),
    project: str("project"),
    database: str("database"),
    pruneUsers: flags.has("prune-users"),
  };
}

async function idsOf(q: Query): Promise<DocumentReference[]> {
  return (await q.select().get()).docs.map((d) => d.ref);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.project) process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = args.project;
  if (args.database !== undefined) process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = args.database;

  console.log(
    `\nProject: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(from credentials)"}   ` +
      `Database: ${process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "(default)"}`,
  );

  const db: Firestore = getAdminDb();

  // Resolve the team by id, then by exact name.
  let teamRef = db.collection("teams").doc(args.team);
  let snap = await teamRef.get();
  if (!snap.exists) {
    const byName = await db.collection("teams").where("name", "==", args.team).get();
    if (byName.empty) {
      const all = await db.collection("teams").get();
      console.error(
        `No team matched "${args.team}". Existing teams:\n` +
          all.docs.map((d) => `  • ${d.data().name} (${d.id})`).join("\n"),
      );
      process.exit(1);
    }
    if (byName.size > 1) {
      console.error(
        `${byName.size} teams named "${args.team}" — pass the id instead:\n` +
          byName.docs.map((d) => `  ${d.id}`).join("\n"),
      );
      process.exit(1);
    }
    teamRef = byName.docs[0].ref;
    snap = byName.docs[0];
  }
  const teamId = teamRef.id;
  const teamName = (snap.data()?.name as string) ?? "(unnamed)";

  console.log(
    `Team: "${teamName}" (${teamId})${args.apply ? "" : "   [DRY RUN — pass --yes to delete]"}\n`,
  );

  // Gather everything first so the report is accurate before anything is
  // deleted, and so a dry run shows exactly what --yes would remove.
  const refs: DocumentReference[] = [];
  const counts: Record<string, number> = {};

  for (const col of TEAM_SCOPED) {
    const found = await idsOf(db.collection(col).where("team_id", "==", teamId));
    counts[col] = found.length;
    refs.push(...found);
  }

  // Children keyed by their parent, not by team_id.
  const metricIds = (
    await db.collection("scorecard_metrics").where("team_id", "==", teamId).select().get()
  ).docs.map((d) => d.id);
  const entryRefs: DocumentReference[] = [];
  for (const mid of metricIds) {
    entryRefs.push(...(await idsOf(db.collection("scorecard_entries").where("metric_id", "==", mid))));
  }
  counts["scorecard_entries"] = entryRefs.length;
  refs.push(...entryRefs);

  const issueIds = (
    await db.collection("issues").where("team_id", "==", teamId).select().get()
  ).docs.map((d) => d.id);
  const voteRefs: DocumentReference[] = [];
  for (const iid of issueIds) {
    voteRefs.push(...(await idsOf(db.collection("issue_votes").where("issue_id", "==", iid))));
  }
  counts["issue_votes"] = voteRefs.length;
  refs.push(...voteRefs);

  const members = (
    await db.collection("team_members").where("team_id", "==", teamId).get()
  ).docs.map((d) => d.data().user_id as string);

  for (const [col, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${col.padEnd(22)} ${n}`);
  }
  console.log(`  ${"teams".padEnd(22)} 1`);
  console.log(`\n  ${refs.length + 1} document(s) total, ${members.length} membership(s).`);
  console.log(
    `  Meetings are removed with recursiveDelete, so their effectiveness_scores\n` +
      `  and presence subcollections go too. audit_log is left intact.`,
  );

  if (!args.apply) {
    console.log(`\nDry run — nothing deleted. Re-run with --yes to apply.`);
    return;
  }

  // Meetings first, recursively (subcollections outlive a plain doc delete).
  const meetingRefs = refs.filter((r) => r.parent.id === "meetings");
  for (const m of meetingRefs) await db.recursiveDelete(m);

  const rest = refs.filter((r) => r.parent.id !== "meetings");
  for (let i = 0; i < rest.length; i += 400) {
    const batch = db.batch();
    for (const ref of rest.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  await teamRef.delete();

  console.log(`\n✓ Deleted "${teamName}" and ${refs.length} related document(s).`);

  // Synthetic members exist only to give imported/seeded rows a name. Once
  // their last team is gone they're unreachable, so offer to sweep them.
  if (args.pruneUsers) {
    const synthetic = members.filter((id) => id.startsWith("demo-") || id.startsWith("import-"));
    const orphaned: string[] = [];
    for (const uid of synthetic) {
      const stillOn = await db.collection("team_members").where("user_id", "==", uid).limit(1).get();
      if (stillOn.empty) orphaned.push(uid);
    }
    for (let i = 0; i < orphaned.length; i += 400) {
      const batch = db.batch();
      for (const uid of orphaned.slice(i, i + 400)) batch.delete(db.collection("users").doc(uid));
      await batch.commit();
    }
    console.log(
      `✓ Pruned ${orphaned.length} orphaned synthetic user doc(s)` +
        (orphaned.length ? `: ${orphaned.join(", ")}` : "") +
        `. Real accounts untouched.`,
    );
  } else {
    const synthetic = members.filter((id) => id.startsWith("demo-") || id.startsWith("import-"));
    if (synthetic.length) {
      console.log(
        `\n${synthetic.length} synthetic /users doc(s) are now orphaned (${synthetic.slice(0, 3).join(", ")}` +
          `${synthetic.length > 3 ? ", …" : ""}). Re-run with --prune-users to remove them.`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
