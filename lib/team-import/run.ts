import type { Firestore } from "firebase-admin/firestore";
import { normalizeKey } from "../csv-import";
import type { CsvTable } from "../csv-import";
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
};

export type TeamImportInputs = {
  scorecard?: { table: CsvTable };
  rocks?: { table: CsvTable };
  milestones?: { table: CsvTable };
  todos?: { table: CsvTable };
  /** Issues may be multi-sheet. */
  issues?: { tables: (CsvTable & { sheetName?: string })[] };
  headlines?: { tables: (CsvTable & { sheetName?: string })[] };
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
  const createOwners = options.createOwners ?? true;
  const includeArchived = options.includeArchived ?? false;
  const completedSince = options.completedSince ?? null;
  const asOf = options.asOf ?? new Date();
  const fallbackId = options.fallbackOwnerId ?? null;
  const unmatchedOwner = options.unmatchedOwner ?? "no-owner";
  const existingRows = options.existingRows ?? "keep";

  const writer = new Writer(db, dryRun);
  const preview = new PreviewCollector();
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

  let rockIdByTitle = new Map<string, string>();
  if (inputs.rocks) {
    const { stats, rockIdByTitle: map } = await importRocks(inputs.rocks.table, {
      teamId,
      writer,
      owners,
      existingIds,
      rockTeam: options.rockTeam,
      existingRows,
      unmatchedOwner,
      includeArchived,
      preview,
    });
    rockIdByTitle = map;
    kinds.push(stats);
  }

  if (inputs.milestones) {
    // Fold in existing team rocks so milestones can link without a rocks
    // file in the same run (or to rocks created in-app).
    const existingRocks = await db.collection("rocks").where("team_id", "==", teamId).get();
    for (const d of existingRocks.docs) {
      const key = normalizeKey((d.data().title as string) ?? "");
      if (key && !rockIdByTitle.has(key)) rockIdByTitle.set(key, d.id);
    }
    kinds.push(
      await importMilestones(inputs.milestones.table, {
        teamId,
        writer,
        owners,
        existingIds,
        rockIdByTitle,
        rockTeam: options.rockTeam,
        includeArchived,
        completedSince,
        unmatchedOwner,
        preview,
        existingRows,
      }),
    );
  }

  if (inputs.todos) {
    kinds.push(
      await importTodos(inputs.todos.table, {
        teamId,
        writer,
        owners,
        existingIds,
        includeArchived,
        completedSince,
        unmatchedOwner,
        preview,
        existingRows,
      }),
    );
  }

  if (inputs.issues) {
    for (const table of inputs.issues.tables) {
      kinds.push(
        await importIssues(table, {
          teamId,
          writer,
          owners,
          existingIds,
          includeArchived,
          completedSince,
          sheetName: table.sheetName,
          unmatchedOwner,
          preview,
          existingRows,
        }),
      );
    }
  }

  if (inputs.headlines) {
    for (const table of inputs.headlines.tables) {
      kinds.push(
        await importHeadlines(table, {
          teamId,
          writer,
          owners,
          existingIds,
          includeArchived,
          rockTeam: options.rockTeam,
          preview,
          existingRows,
        }),
      );
    }
  }

  await writer.flush();

  return {
    dryRun,
    writes: writer.written,
    kinds,
    placeholdersCreated: owners.created,
    unresolvedOwners: [...owners.unresolved],
    rows: preview.rows,
    previewTruncated: preview.truncated,
  };
}
