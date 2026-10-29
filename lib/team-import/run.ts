import type { Firestore } from "firebase-admin/firestore";
import { normalizeKey } from "../csv-import";
import type { CsvTable } from "../csv-import";
import { syncUsersTeamIds } from "../firebase/membership";
import type { ImportReport } from "../team-import-types";
import { importHeadlines } from "./headlines";
import { importIssues } from "./issues";
import { importMilestones } from "./milestones";
import { loadExistingIds, loadMembers, OwnerResolver, PreviewCollector, Writer } from "./owners";
import type { Member } from "./owners";
import { importRocks } from "./rocks";
import { importScorecard } from "./scorecard";
import { importTodos } from "./todos";
import type { KindStats } from "../team-import-types";

export type TeamImportOptions = {
  dryRun?: boolean;
  /** Signed-in importer, stamped on every write (C-07). Omitted by the CLI. */
  actorUid?: string | null;
  /** Create placeholder members for unmatched Owner names (default true for CLI). */
  createOwners?: boolean;
  /** Park unmatched owners on this existing member uid. */
  fallbackOwnerId?: string | null;
  /** CSV Name → member uid. */
  ownerAliases?: Map<string, string>;
  includeArchived?: boolean;
  /** Drop completed todos/milestones/issues before this YYYY-MM-DD. */
  completedSince?: string | null;
  /**
   * Filter rocks/milestones/headlines by the export's Team/Department column
   * (e.g. "Enterprise Systems & Data"). UI label: Department.
   */
  rockTeam?: string;
  /**
   * What to do with a row that collides with something already on the team
   * (matched on the deterministic `imp-*` id — same title, same team).
   *   "keep"   — leave the stored doc exactly as it is (default).
   *   "update" — rewrite it from the file.
   *
   * Collision protection is on by default rather than opt-in: the team edits
   * this data in the app, and a re-drop of the same export would otherwise
   * silently overwrite that work. The common case is re-uploading a
   * rocks+milestones workbook only to pull the milestones in — the rocks are
   * still title→id mapped when kept, so the milestones attach to them.
   */
  existingRows?: "keep" | "update";
  /**
   * What to do with a row whose Owner name matches nobody on the team (and
   * that neither createOwners nor fallbackOwnerId caught).
   *   "no-owner" — import it with `owner_id: null` and keep the name in the
   *                description (default). A departed employee's rows still
   *                land and the history stays visible.
   *   "skip"     — drop the row.
   *
   * Defaults to "no-owner": losing rows silently is worse than importing them
   * unassigned, and an unowned row is visible and fixable in the app.
   */
  unmatchedOwner?: "skip" | "no-owner";
  asOf?: Date;
  /** Preview rows to keep (default 250 — the single-file preview list). */
  previewLimit?: number;
  /** Source position per row object, stamped on preview rows (bulk import). */
  rowRefs?: WeakMap<object, { table: string; row: number }>;
  /** import_runs doc id, stamped as `import_run_id` on every doc written. */
  importRunId?: string | null;
};

export type TeamImportInputs = {
  scorecard?: { table: CsvTable };
  rocks?: { table: CsvTable };
  milestones?: { table: CsvTable };
  todos?: { table: CsvTable };
  /** Issues may be multi-sheet. */
  issues?: { tables: (CsvTable & { sheetName?: string })[] };
  headlines?: { tables: (CsvTable & { sheetName?: string })[] };
  /**
   * Tables from ninety's archived exports (separate files from the live
   * ones). Every row lands archived — "Include archived rows" doesn't gate
   * them — and their ids include the row's dates so repeated titles in the
   * history stay separate records (normalize.ts archiveKey).
   */
  archive?: Omit<TeamImportInputs, "archive" | "scorecard">;
};

/**
 * Run a team import from pre-parsed tables. Callers (CLI / server action)
 * own reading files and resolving the team.
 */
export async function runTeamImport(
  db: Firestore,
  teamId: string,
  inputs: TeamImportInputs,
  options: TeamImportOptions = {},
  members?: Member[],
): Promise<ImportReport> {
  const dryRun = options.dryRun ?? false;
  const createOwners = options.createOwners ?? false;
  const includeArchived = options.includeArchived ?? false;
  const completedSince = options.completedSince ?? null;
  const asOf = options.asOf ?? new Date();
  const fallbackId = options.fallbackOwnerId ?? null;
  const unmatchedOwner = options.unmatchedOwner ?? "no-owner";
  const existingRows = options.existingRows ?? "keep";

  const writer = new Writer(db, dryRun, options.actorUid, options.importRunId);
  const preview = new PreviewCollector(options.previewLimit, options.rowRefs);
  const teamMembers = members ?? (await loadMembers(db, teamId));
  const owners = new OwnerResolver(teamId, teamMembers, {
    createOwners,
    fallbackId,
    aliases: options.ownerAliases,
    writer,
  });

  const existingIds = await loadExistingIds(db, teamId, [
    "scorecard_metrics",
    "scorecard_groups",
    "rocks",
    "todos",
    "issues",
    "headlines",
  ]);

  const kinds: KindStats[] = [];

  if (inputs.scorecard) {
    kinds.push(
      await importScorecard(inputs.scorecard.table, {
        teamId,
        writer,
        owners,
        asOf,
        includeArchived,
        existingIds,
        unmatchedOwner,
        preview,
      }),
    );
  }

  // Live rows first, then the archived exports (TeamImportInputs.archive).
  // The archived pass gets its own rock map: archived milestones belong to
  // archived rocks, and a live rock of the same title must not catch them.
  let existingRocks: Map<string, string> | null = null;
  const teamRocks = async () => {
    if (!existingRocks) {
      existingRocks = new Map();
      const snap = await db.collection("rocks").where("team_id", "==", teamId).get();
      for (const d of snap.docs) {
        const key = normalizeKey((d.data().title as string) ?? "");
        if (key && !existingRocks.has(key)) existingRocks.set(key, d.id);
      }
    }
    return existingRocks;
  };

  let liveRockIds = new Map<string, string>();
  for (const [pass, archive] of [
    [inputs, false],
    [inputs.archive, true],
  ] as const) {
    if (!pass) continue;
    const label = (stats: KindStats) =>
      archive ? { ...stats, label: `${stats.label} (archived)` } : stats;

    let rockIdByTitle = new Map<string, string>();
    // Rocks in this pass's file that didn't import, and why — so a milestone
    // pointing at one says so instead of "No rock named".
    const rocksNotImported = new Map<string, string>();
    if (pass.rocks) {
      const stop = preview.observe((r) => {
        if (r.kind === "rocks" && r.action === "skip" && r.note) {
          rocksNotImported.set(normalizeKey(r.title), r.note);
        }
      });
      const { stats, rockIdByTitle: map } = await importRocks(pass.rocks.table, {
        teamId,
        writer,
        owners,
        existingIds,
        rockTeam: options.rockTeam,
        existingRows,
        unmatchedOwner,
        includeArchived,
        archive,
        preview,
      });
      stop();
      rockIdByTitle = map;
      kinds.push(label(stats));
    }
    if (!archive) liveRockIds = rockIdByTitle;

    if (pass.milestones) {
      // Rocks from this pass win; then (archived pass) this upload's live
      // rocks; then rocks already on the team, so milestones can link without
      // a rocks file in the same run (or to rocks created in-app).
      const linkable = new Map(rockIdByTitle);
      for (const source of [archive ? liveRockIds : new Map<string, string>(), await teamRocks()]) {
        for (const [key, id] of source) if (!linkable.has(key)) linkable.set(key, id);
      }
      kinds.push(
        label(
          await importMilestones(pass.milestones.table, {
            teamId,
            writer,
            owners,
            existingIds,
            rockIdByTitle: linkable,
            rocksNotImported,
            rockTeam: options.rockTeam,
            includeArchived,
            archive,
            completedSince,
            unmatchedOwner,
            preview,
            existingRows,
          }),
        ),
      );
    }

    if (pass.todos) {
      kinds.push(
        label(
          await importTodos(pass.todos.table, {
            teamId,
            writer,
            owners,
            existingIds,
            includeArchived,
            archive,
            completedSince,
            unmatchedOwner,
            preview,
            existingRows,
            rockTeam: options.rockTeam,
          }),
        ),
      );
    }

    for (const table of pass.issues?.tables ?? []) {
      kinds.push(
        label(
          await importIssues(table, {
            teamId,
            writer,
            owners,
            existingIds,
            includeArchived,
            archive,
            completedSince,
            sheetName: table.sheetName,
            unmatchedOwner,
            preview,
            existingRows,
            rockTeam: options.rockTeam,
          }),
        ),
      );
    }

    for (const table of pass.headlines?.tables ?? []) {
      kinds.push(
        label(
          await importHeadlines(table, {
            teamId,
            writer,
            owners,
            existingIds,
            includeArchived,
            archive,
            rockTeam: options.rockTeam,
            preview,
            existingRows,
          }),
        ),
      );
    }
  }

  await writer.flush();
  // Placeholder owners got a team_members row in the batch just flushed.
  if (!dryRun) await syncUsersTeamIds(
      db,
      owners.created.map((c) => c.user_id),
      options.actorUid,
    );

  return {
    dryRun,
    writes: writer.written,
    kinds,
    placeholdersCreated: owners.created,
    unresolvedOwners: [...owners.unresolved],
    rows: preview.rows,
    previewTruncated: preview.truncated,
    collisions: writer.collisions,
  };
}
