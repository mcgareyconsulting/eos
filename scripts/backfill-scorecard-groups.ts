// N40 — create `scorecard_groups` docs for group names that already exist as
// free text on `scorecard_metrics`.
//
// Metrics have carried a `group` string since the first import; the group DOC
// (which is what holds the period and the chosen order) only started being
// written on 2026-08-24. Without a doc, a name is treated as an unmanaged
// label and sorts alphabetically after the defined groups — so a team
// imported before that date shows Compliance ABOVE Weekly, which is the exact
// thing N40 set out to fix. This closes that gap without a re-import.
//
// Order: groups are numbered by each metric's `sort_order`, so the sequence
// matches the order the measurables were imported in — the same first-seen
// rule the importer now applies. Re-order afterwards in the Groups modal if
// the file's order isn't the order the team wants.
//
// Idempotent and non-destructive: a group that already has a doc is left
// exactly as it is, so this never overwrites a hand-set position or period.
// Every group is created weekly, matching the importer (which imports all
// measurables as weekly) — change a group's period in the modal afterwards.
//
// Usage:
//   pnpm tsx scripts/backfill-scorecard-groups.ts
//   pnpm tsx scripts/backfill-scorecard-groups.ts --apply
//
// Targets whatever `.env.local` points at (same as seed / import). Confirm
// the printed project + database before --apply.

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";
import { groupDocId, normalizeGroupName } from "../lib/scorecard-groups";

type Pending = {
  teamId: string;
  name: string;
  /** Lowest metric sort_order seen for this group — decides its position. */
  firstSeen: number;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const project =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset project)";
  const database =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "(default)";
  const db = getAdminDb();

  console.log(
    `\nN40 scorecard group backfill  project=${project}  database=${database}  mode=${apply ? "APPLY" : "dry-run"}\n`,
  );

  const [metricsSnap, groupsSnap] = await Promise.all([
    db.collection("scorecard_metrics").get(),
    db.collection("scorecard_groups").get(),
  ]);

  const existing = new Set(groupsSnap.docs.map((d) => d.id));

  // Keyed by doc id so two casings of the same name collapse into one group.
  const pending = new Map<string, Pending>();
  for (const d of metricsSnap.docs) {
    const x = d.data();
    const teamId = String(x.team_id ?? "");
    const name = normalizeGroupName(String(x.group ?? ""));
    if (!teamId || !name) continue;

    const id = groupDocId(teamId, name);
    if (existing.has(id)) continue;

    const order = Number(x.sort_order ?? 0);
    const seen = pending.get(id);
    if (!seen) {
      pending.set(id, { teamId, name, firstSeen: order });
    } else if (order < seen.firstSeen) {
      // Keep the earliest position, and the casing that came with it.
      pending.set(id, { teamId, name, firstSeen: order });
    }
  }

  if (pending.size === 0) {
    console.log("Nothing to do — every group name already has a group doc.\n");
    return;
  }

  // Position is per team, densely numbered from the metric order.
  const byTeam = new Map<string, { id: string; row: Pending }[]>();
  for (const [id, row] of pending) {
    const list = byTeam.get(row.teamId) ?? [];
    list.push({ id, row });
    byTeam.set(row.teamId, list);
  }

  const batch = db.batch();
  let created = 0;

  for (const [teamId, rows] of byTeam) {
    // Existing weekly groups on this team already occupy positions; append
    // after them rather than colliding at 0.
    const taken = groupsSnap.docs
      .filter(
        (d) =>
          String(d.data().team_id ?? "") === teamId &&
          String(d.data().interval ?? "weekly") === "weekly",
      )
      .map((d) => Number(d.data().sort_order ?? 0));
    const base = taken.length === 0 ? 0 : Math.max(...taken) + 1;

    rows.sort((a, b) => a.row.firstSeen - b.row.firstSeen);
    rows.forEach(({ id, row }, i) => {
      const sort_order = base + i;
      console.log(
        `  ${teamId}  ${String(sort_order).padStart(2)}  ${row.name}` +
          `${apply ? "" : "   (dry-run)"}`,
      );
      created++;
      if (!apply) return;
      batch.set(db.collection("scorecard_groups").doc(id), {
        team_id: teamId,
        name: row.name,
        interval: "weekly",
        sort_order,
        import_source: "backfill",
      });
    });
  }

  console.log(
    `\n${created} group${created === 1 ? "" : "s"} across ${byTeam.size} team${byTeam.size === 1 ? "" : "s"}`,
  );

  if (!apply) {
    console.log("Dry run — re-run with --apply to write.\n");
    return;
  }

  await batch.commit();
  console.log("Done. Re-order in the Groups modal if the order isn't right.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
