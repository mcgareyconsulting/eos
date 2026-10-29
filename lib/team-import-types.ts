// Serializable import report shapes — safe for client components.
// Kept separate from lib/team-import.ts (firebase-admin / node:zlib).

export type ImportKind =
  | "scorecard"
  | "rocks"
  | "milestones"
  | "todos"
  | "issues"
  | "headlines";

export type KindStats = {
  kind: ImportKind;
  label: string;
  imported: number;
  skipped: number;
  /** Rows that matched an existing doc and were deliberately left alone. */
  unchanged?: number;
  details: string[];
  warnings: string[];
};

/**
 * One row as the importer actually read it — resolved owner, the fields that
 * decide where it lands, and what would happen to it. Preview used to show
 * only the filename and a write count, which told nobody whether the mapping
 * was right. The dry run has to show what will land, row by row.
 */
export type PreviewRow = {
  kind: ImportKind;
  /** create = new doc, update = matched an existing one, skip = not imported. */
  action: "create" | "update" | "skip";
  title: string;
  /** Resolved member name, "No Owner", or the unmatched name from the file. */
  owner: string;
  /** Kind-specific descriptors, e.g. ["Team rock", "2026-Q3", "due 2026-09-30"]. */
  detail: string[];
  /** Why it was skipped, or what is notable about it. */
  note?: string;
  /** Which file row this came from — set on bulk imports only. */
  ref?: { table: string; row: number };
};

export type ImportReport = {
  dryRun: boolean;
  writes: number;
  kinds: KindStats[];
  placeholdersCreated: { user_id: string; name: string }[];
  unresolvedOwners: string[];
  /** Per-row detail, capped — see previewTruncated for the overflow count. */
  rows: PreviewRow[];
  /** Rows beyond the cap, not listed. */
  previewTruncated: number;
  /** Rows that landed on a record an earlier row in the same upload wrote. */
  collisions: number;
};

/**
 * One sheet of a bulk upload as the preview grid shows it: the file's own
 * cells, which columns the importer reads, and which date cells it can't.
 * The per-row verdict comes from ImportReport.rows (joined on `ref`).
 */
export type BulkGridTable = {
  /** `file` or `file › sheet`. */
  id: string;
  file: string;
  sheet: string | null;
  /** What the headers say it is (null = couldn't tell). */
  detected: ImportKind | null;
  /** Why — "has “Rock Name”", "sheet name “Short Term Issues”"… */
  reason: string;
  /** From an archived export: every row imports archived. */
  archived: boolean;
  /** What it is being imported as (override, or detected). null = left out. */
  kind: ImportKind | null;
  /** The file's headers, minus Link (ninety.io links — nothing to check). */
  headers: string[];
  /** Per header: does the importer read this column? */
  used: boolean[];
  /** Cell values by header, capped at GRID_ROW_CAP rows. */
  rows: string[][];
  totalRows: number;
  /** [row, col] of non-empty date cells that don't parse. */
  badCells: [number, number][];
};

/** A file or sheet a bulk upload left out, and why. Shown above the grid. */
export type BulkNotice = { file: string; message: string };
