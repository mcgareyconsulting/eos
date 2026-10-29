// Bulk import: a .zip (or several loose files) of a team's ninety export →
// one TeamImportInputs. Every sheet of every file is classified on its own by
// its column headers, because the export packs more than one kind per
// workbook (Rocks + Milestones tabs, Short- + Long-Term issue tabs) and the
// file names are whatever the person who exported them typed.
//
// Pure — no Firestore. The server action reads the upload, runs
// readBulkTables → assembleBulkInputs → runTeamImport, and sends
// toGridTables back for the preview grid.

import {
  cell,
  normalizeKey,
  parseDateOnly,
  parseDelimited,
  parseWeekHeader,
  toTable,
  type CsvTable,
} from "../csv-import";
import type { BulkGridTable, BulkNotice, ImportKind } from "../team-import-types";
import { readXlsx, readZip } from "../xlsx";
import type { TeamImportInputs } from "./run";

export type UploadFile = { name: string; bytes: Buffer };

/** One sheet (or one CSV) from the upload. */
export type SourceTable = {
  /** `file` or `file › sheet` — stable between the preview and the apply. */
  id: string;
  file: string;
  sheet: string | null;
  table: CsvTable;
  detected: ImportKind | null;
  reason: string;
};


const MAX_FILES = 40;
const SPREADSHEET = /\.(xlsx|csv|tsv)$/i;

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** macOS zips carry resource forks and Finder files alongside the real ones. */
function isZipJunk(path: string): boolean {
  const base = baseName(path);
  return (
    path.startsWith("__MACOSX/") ||
    path.includes("/__MACOSX/") ||
    base.startsWith("._") ||
    base === ".DS_Store" ||
    base.startsWith("~$") // Excel lock file
  );
}

/**
 * Unpack .zip uploads and keep the spreadsheets. Loose .xlsx/.csv/.tsv pass
 * straight through, so dropping files and dropping a zip of them land the same.
 */
export function expandUploads(files: UploadFile[]): {
  files: UploadFile[];
  notices: BulkNotice[];
} {
  const out: UploadFile[] = [];
  const notices: BulkNotice[] = [];

  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      let entries;
      try {
        entries = readZip(f.bytes);
      } catch (e) {
        notices.push({ file: f.name, message: e instanceof Error ? e.message : "Could not open the zip." });
        continue;
      }
      for (const entry of entries) {
        if (isZipJunk(entry.name)) continue;
        if (!SPREADSHEET.test(entry.name)) {
          notices.push({ file: `${f.name} › ${entry.name}`, message: "Not a spreadsheet — left out." });
          continue;
        }
        out.push({ name: entry.name, bytes: entry.bytes });
      }
    } else if (SPREADSHEET.test(f.name)) {
      out.push(f);
    } else {
      notices.push({ file: f.name, message: "Not a .zip, .xlsx, .csv or .tsv — left out." });
    }
  }

  if (out.length > MAX_FILES) {
    throw new Error(`That's ${out.length} spreadsheets — the limit is ${MAX_FILES} per import.`);
  }
  // Same name twice (a zip plus one of its files dropped loose) would make
  // two tables with the same id, and exclusions could not tell them apart.
  const seen = new Set<string>();
  const unique = out.filter((f) => {
    if (seen.has(f.name)) {
      notices.push({ file: f.name, message: "Appears twice in the upload — read once." });
      return false;
    }
    seen.add(f.name);
    return true;
  });
  return { files: unique, notices };
}

/** Every non-empty sheet of every file, classified. */
export function readBulkTables(
  files: UploadFile[],
  asOf: Date = new Date(),
): { tables: SourceTable[]; notices: BulkNotice[] } {
  const tables: SourceTable[] = [];
  const notices: BulkNotice[] = [];

  for (const f of files) {
    let sheets: { name: string | null; rows: string[][] }[];
    try {
      sheets = /\.xlsx$/i.test(f.name)
        ? readXlsx(f.bytes)
        : [{ name: null, rows: parseDelimited(f.bytes.toString("utf8")) }];
    } catch (e) {
      notices.push({ file: f.name, message: e instanceof Error ? e.message : "Could not read the file." });
      continue;
    }

    for (const sh of sheets) {
      const table = toTable(sh.rows);
      const id = sh.name ? `${f.name} › ${sh.name}` : f.name;
      if (table.rows.length === 0) {
        // ninety writes a header-only sheet when a section has nothing in it.
        notices.push({ file: id, message: "No data rows — nothing to import." });
        continue;
      }
      const { kind, reason } = classifyTable(table.headers, sh.name, f.name, asOf);
      tables.push({ id, file: f.name, sheet: sh.name, table, detected: kind, reason });
    }
  }
  return { tables, notices };
}

function headerSet(headers: string[]): Set<string> {
  return new Set(headers.map((h) => normalizeKey(h)).filter(Boolean));
}

/**
 * What kind of table this is, from its headers first and its sheet / file
 * name second. Each ninety export has one column no other export has; the
 * checks run most-specific first because the exports share most columns
 * (Owner, Title, Description, Team, Completed On…).
 */
export function classifyTable(
  headers: string[],
  sheetName: string | null,
  fileName: string,
  asOf: Date = new Date(),
): { kind: ImportKind | null; reason: string } {
  const has = headerSet(headers);
  const any = (...names: string[]) => names.find((n) => has.has(normalizeKey(n)));

  const weeks = headers.filter((h) => parseWeekHeader(h, asOf) !== null).length;
  if (weeks > 0 && (any("Goal", "Target") || weeks >= 2)) {
    return { kind: "scorecard", reason: `${weeks} week column${weeks === 1 ? "" : "s"}` };
  }
  // Milestones name their rock; a rocks export has Level/Quarter instead
  // (and "Rock Name" is an accepted title alias for rocks, so guard on them).
  let col = any("Rock Name", "Parent Rock");
  if (col && !any("Level", "Quarter")) return { kind: "milestones", reason: `has “${col}”` };
  col = any("From", "Team From");
  if (col) return { kind: "headlines", reason: `has “${col}”` };
  col = any("Priority", "Who");
  if (col) return { kind: "issues", reason: `has “${col}”` };
  col = any("Level", "Quarter");
  if (col) return { kind: "rocks", reason: `has “${col}”` };
  col = any("Repeat", "Recurrence");
  if (col) return { kind: "todos", reason: `has “${col}”` };

  for (const [label, name] of [
    ["sheet", sheetName],
    ["file", baseName(fileName).replace(/\.[^.]+$/, "")],
  ] as const) {
    if (!name) continue;
    const kind = kindFromName(name);
    if (kind) return { kind, reason: `${label} name “${name}”` };
  }
  return { kind: null, reason: "Columns don't match a known export — pick a type" };
}

function kindFromName(name: string): ImportKind | null {
  if (/milestone/i.test(name)) return "milestones";
  if (/headline|cascad/i.test(name)) return "headlines";
  if (/issue|short.?term|long.?term/i.test(name)) return "issues";
  if (/rock/i.test(name)) return "rocks";
  if (/to-?dos?|task/i.test(name)) return "todos";
  if (/scorecard|measurable|metric/i.test(name)) return "scorecard";
  return null;
}

export const rowKey = (tableId: string, row: number) => `${tableId}#${row}`;

/**
 * Fold the classified tables into one import. `kinds` is the effective kind
 * per table id (detected, or the user's override; null = leave out);
 * `exclude` holds rowKey()s the user unticked.
 *
 * Rocks, milestones, to-dos and scorecard take a single table, so several of
 * one kind are merged (header union — rows are keyed by header, so differing
 * column orders line up). Issues and headlines keep one table per sheet: the
 * sheet name is their Type fallback.
 */
export function assembleBulkInputs(
  tables: SourceTable[],
  kinds: Map<string, ImportKind | null>,
  exclude: Set<string> = new Set(),
): { inputs: TeamImportInputs; refs: WeakMap<object, { table: string; row: number }> } {
  const refs = new WeakMap<object, { table: string; row: number }>();
  const merged = new Map<"scorecard" | "rocks" | "milestones" | "todos", CsvTable>();
  const issues: (CsvTable & { sheetName?: string })[] = [];
  const headlines: (CsvTable & { sheetName?: string })[] = [];

  for (const src of tables) {
    const kind = kinds.has(src.id) ? kinds.get(src.id)! : src.detected;
    if (!kind) continue;
    const rows = src.table.rows.filter((row, i) => {
      if (exclude.has(rowKey(src.id, i))) return false;
      refs.set(row, { table: src.id, row: i });
      return true;
    });
    if (rows.length === 0) continue;

    if (kind === "issues" || kind === "headlines") {
      const sheetName = src.sheet ?? baseName(src.file).replace(/\.[^.]+$/, "");
      (kind === "issues" ? issues : headlines).push({ headers: src.table.headers, rows, sheetName });
      continue;
    }
    const prev = merged.get(kind);
    merged.set(
      kind,
      prev
        ? {
            headers: [...prev.headers, ...src.table.headers.filter((h) => !prev.headers.includes(h))],
            rows: [...prev.rows, ...rows],
          }
        : { headers: src.table.headers, rows },
    );
  }

  const inputs: TeamImportInputs = {};
  for (const [kind, table] of merged) inputs[kind] = { table };
  if (issues.length > 0) inputs.issues = { tables: issues };
  if (headlines.length > 0) inputs.headlines = { tables: headlines };
  return { inputs, refs };
}

/**
 * The Department filter for this import, from the team being imported into.
 * There is one team picker, so the file's Team column is matched against it:
 *   - the column names this team → filter to it (multi-department export);
 *   - one other name, or blank   → no filter: it's this team's own export and
 *                                  ninety just spells the team differently;
 *   - several names, none match  → filter (nothing lands) and say what the
 *                                  file does contain.
 * Scorecard and milestones have no Team column and are never filtered.
 */
export function teamFilterFor(
  tables: SourceTable[],
  kinds: Map<string, ImportKind | null>,
  teamName: string,
): { rockTeam?: string; notice?: BulkNotice } {
  const values = new Map<string, string>();
  for (const src of tables) {
    const kind = kinds.has(src.id) ? kinds.get(src.id)! : src.detected;
    if (!kind || kind === "scorecard" || kind === "milestones") continue;
    for (const row of src.table.rows) {
      const v = cell(row, src.table.headers, "Team", "Department", "Dept", "Department Name");
      if (v) values.set(normalizeKey(v), v);
    }
  }
  if (values.has(normalizeKey(teamName))) return { rockTeam: teamName };
  if (values.size <= 1) return {};
  return {
    rockTeam: teamName,
    notice: {
      file: "Team column",
      message: `The export covers ${[...values.values()].join(", ")} — none is ${teamName}, so those rows were left out. Pick the matching team above.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Preview grid
// ---------------------------------------------------------------------------

const TEAM = ["Team", "Department", "Dept", "Department Name"];
const OWNER = ["Owner", "Owner Name", "Accountable"];
const ARCHIVE = ["Archived Date", "Archived On", "Archived"];
const CREATED = ["Created Date", "Created On", "Created"];
const LINK = ["Link", "URL"];

/**
 * Columns each importer reads (aliases included). Display-only: the grid
 * greys out the rest so nobody wonders where a column went. Keep in step
 * with the cell() calls in the kind importers.
 */
const READ_COLUMNS: Record<ImportKind, string[]> = {
  rocks: [
    "Title", "Name", "Rock", "Rock Name", ...OWNER, "Description", "Due Date", "Due",
    "Status", "Level", "Type", "Rock Type", ...TEAM, "Completed On", "Completed",
    "Completed Date", ...LINK, ...CREATED, "Quarter", "Attachment Names", "Attachments", ...ARCHIVE,
  ],
  milestones: [
    "Title", "Name", "Milestone", ...OWNER, "Rock Name", "Rock", "Parent Rock",
    "Description", "Due Date", "Due", "Completed On", "Completed", ...LINK, ...ARCHIVE,
  ],
  todos: [
    "Title", "Name", "To-Do", "Todo", "Task", ...OWNER, "Assignee", "Description", "Notes",
    "Due Date", "Due", "Repeat", "Recurrence", "Repeats", ...TEAM, "Completed On", "Completed",
    ...LINK, ...CREATED, ...ARCHIVE, "Visibility", "Private", "Status",
  ],
  issues: [
    "Title", "Name", "Issue", ...OWNER, "Assignee", "Description", "Notes", "Type", "Term",
    "Horizon", "Status", "Priority", ...TEAM, "Who", "Completed On", "Completed", "Resolved On",
    ...LINK, ...CREATED, ...ARCHIVE,
  ],
  headlines: [
    "Title", "Name", "Headline", ...OWNER, "From Name", "From", "Source", "Team From",
    "Description", "Notes", "Body", "Detail", "Type", "Kind", "Category", ...TEAM, ...LINK,
    ...CREATED, ...ARCHIVE, "Status",
  ],
  scorecard: [
    "Title", "Name", "Metric", "Measurable", ...OWNER, "Group Name", "Group", "Section",
    "Description", "Goal", "Target", "Status", "Unit",
  ],
};

const DATE_COLUMNS = new Set(
  ["Due Date", "Due", "Completed On", "Completed Date", "Resolved On", ...CREATED, "Archived Date", "Archived On"].map(
    normalizeKey,
  ),
);

const LINK_COLUMNS = new Set(LINK.map(normalizeKey));

/** Grid rows per table sent to the browser. Counts above always cover all. */
export const GRID_ROW_CAP = 2000;
/** Long descriptions are clipped in the grid — it's for eyeballing, not reading. */
const GRID_CELL_MAX = 300;

/**
 * Raw cells per table for the preview grid, with the columns the importer
 * ignores and the date cells it can't read marked. The import verdict per
 * row (report.rows[].ref) is joined on the client.
 */
export function toGridTables(
  tables: SourceTable[],
  kinds: Map<string, ImportKind | null>,
  asOf: Date = new Date(),
): BulkGridTable[] {
  return tables.map((src) => {
    const kind = kinds.has(src.id) ? kinds.get(src.id)! : src.detected;
    const read = new Set((kind ? READ_COLUMNS[kind] : []).map(normalizeKey));
    // Link is masked: ninety's points back into ninety (dropped on import),
    // so the column is noise when checking the data.
    const headers = src.table.headers.filter((h) => !LINK_COLUMNS.has(normalizeKey(h)));
    const used = headers.map(
      (h) =>
        !!h &&
        (read.has(normalizeKey(h)) || (kind === "scorecard" && parseWeekHeader(h, asOf) !== null)),
    );
    const dateCols = headers.map((h, c) => used[c] && DATE_COLUMNS.has(normalizeKey(h)));

    const shown = src.table.rows.slice(0, GRID_ROW_CAP);
    const badCells: [number, number][] = [];
    const rows = shown.map((row, r) =>
      headers.map((h, c) => {
        const v = h ? (row[h] ?? "") : "";
        if (dateCols[c] && v && parseDateOnly(v) === null) badCells.push([r, c]);
        return v.length > GRID_CELL_MAX ? `${v.slice(0, GRID_CELL_MAX)}…` : v;
      }),
    );

    return {
      id: src.id,
      file: src.file,
      sheet: src.sheet,
      detected: src.detected,
      reason: src.reason,
      kind,
      headers,
      used,
      rows,
      totalRows: src.table.rows.length,
      badCells,
    };
  });
}
