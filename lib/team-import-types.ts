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
 * was right (N6 finding 2 / Jessica's dry-run ask).
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
};
