// Serializable people-seed import shapes — safe for client components.
// Kept separate from lib/user-import/* (firebase-admin) for the same reason
// lib/team-import-types.ts is: the Import UI imports these types, and pulling
// the admin SDK into a "use client" module is a build error.

/** One person-row as the seed file actually reads. */
export type SeedPersonRow = {
  /** 1-based data-row number (header excluded) — how the operator finds it. */
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  /** Team names exactly as written in the file. A cell may name several. */
  teams: string[];
  /**
   * The file's Role/Title column, captured verbatim onto the profile.
   * **Never** grants access: the client's role values are job titles, not app
   * permissions, so every imported membership lands as `member` regardless.
   * Team leadership and org admin stay manual (Members tab / admin:set-role).
   */
  title: string | null;
};

/** A row (or a whole person) the import could not take, and why. */
export type SeedIssue = {
  /** 0 when the problem belongs to a merged person rather than one row. */
  line: number;
  /** Enough of the row to locate it in the file. */
  label: string;
  reason: string;
};

export type SeedTeamPlan = {
  /** Name as the import will store it (first spelling seen in the file). */
  name: string;
  /** Existing team matched by name, or null when the import will create it. */
  teamId: string | null;
  action: "create" | "match";
  /** Emails the file puts on this team. */
  emails: string[];
};

export type SeedPersonPlan = {
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  /** Deduped team names from every row this person appeared on. */
  teams: string[];
  /** Every line this person appeared on — more than one means rows merged. */
  lines: number[];
};

export type SeedPlan = {
  people: SeedPersonPlan[];
  teams: SeedTeamPlan[];
  issues: SeedIssue[];
};

/**
 * One person→team pairing as the run would apply it. `skip` covers a person
 * the file names but who needs no write (already on the team).
 */
export type SeedPreviewRow = {
  action: "create" | "update" | "skip";
  name: string;
  email: string;
  /** Team name, or "—" for a person the file gives no team. */
  team: string;
  title: string | null;
  note?: string;
};

export type SeedReport = {
  dryRun: boolean;
  /** Firestore document writes (dry run counts what it would have written). */
  writes: number;
  teams: {
    created: number;
    matched: number;
    names: { name: string; action: "create" | "match" }[];
  };
  people: {
    /** Auth accounts created (empty records — nobody is emailed). */
    authCreated: number;
    /** Auth accounts that already existed and were reused as-is. */
    authExisting: number;
    profilesWritten: number;
  };
  memberships: { created: number; existing: number };
  /**
   * Teams the file touches that end up with no leader at all. The role column
   * is deliberately not read (see SeedPersonRow.title), so every team this
   * import creates starts leaderless — surfaced here so the admin promotes
   * someone instead of discovering it when nobody can manage the team.
   */
  leaderless: string[];
  /**
   * Per team: people on the roster in the app but absent from the file. The
   * import is additive and never removes anyone, so this is a review list —
   * the admin decides, row by row, on the People tab.
   */
  notInFile: { team: string; names: string[] }[];
  issues: SeedIssue[];
  /** Per-pairing detail, capped — see previewTruncated for the overflow. */
  rows: SeedPreviewRow[];
  previewTruncated: number;
};
