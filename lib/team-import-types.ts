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

export type ImportReport = {
  dryRun: boolean;
  writes: number;
  kinds: KindStats[];
  placeholdersCreated: { user_id: string; name: string }[];
  unresolvedOwners: string[];
};
