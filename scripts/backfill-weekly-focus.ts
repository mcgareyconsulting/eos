// One-time migration for N50: lift the `**` title convention into the
// `weekly_focus` field and strip the marker from the title.
//
// Modelled on scripts/backfill-scorecard-groups.ts — the same shape of change
// (a convention typed into a text field becoming a real field), so the same
// shape of migration.
//
// Two things learned from the live data (ES team, 2026-09-04) that this
// handles and a naive version would not:
//   1. The marker appears BOTH as "** Title" and "**Title".
//   2. ARCHIVED to-dos carry it too — a backfill that only walked active rows
//      would leave history inconsistent with the field.
//
// Idempotent: a second run reports 0 changes. Dry-run by default.
//
//   pnpm tsx scripts/backfill-weekly-focus.ts              # dry run, all teams
//   pnpm tsx scripts/backfill-weekly-focus.ts --apply
//   pnpm tsx scripts/backfill-weekly-focus.ts --team <id> --apply
import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";
import { migrateFocusMarker } from "../lib/weekly-focus";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const teamIdx = args.indexOf("--team");
  const teamId = teamIdx !== -1 ? args[teamIdx + 1] : null;

  const db = getAdminDb();
  let q = db.collection("todos") as FirebaseFirestore.Query;
  if (teamId) q = q.where("team_id", "==", teamId);
  const snap = await q.get();

  const changes: { id: string; from: string; to: string; archived: boolean }[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const next = migrateFocusMarker({
      title: data.title,
      weekly_focus: data.weekly_focus,
    });
    if (!next) continue;
    changes.push({
      id: d.id,
      from: String(data.title ?? ""),
      to: next.title,
      archived: data.archived_at != null,
    });
  }

  console.log(
    `\n${snap.size} to-do(s) scanned${teamId ? ` on team ${teamId}` : ""}; ` +
      `${changes.length} carry the \`**\` marker.\n`,
  );
  for (const c of changes) {
    console.log(`  ${c.archived ? "[archived] " : ""}${JSON.stringify(c.from)}`);
    console.log(`    → ${JSON.stringify(c.to)}  weekly_focus: true`);
  }

  if (changes.length === 0) {
    console.log("Nothing to do.\n");
    process.exit(0);
  }
  if (!apply) {
    console.log("\nDry run — re-run with --apply to write.\n");
    process.exit(0);
  }

  // Chunked: Firestore caps a batch at 500 writes.
  const CHUNK = 400;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const batch = db.batch();
    for (const c of changes.slice(i, i + CHUNK)) {
      batch.update(db.collection("todos").doc(c.id), {
        title: c.to,
        weekly_focus: true,
      });
    }
    await batch.commit();
  }
  console.log(`\nApplied ${changes.length} update(s).\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
