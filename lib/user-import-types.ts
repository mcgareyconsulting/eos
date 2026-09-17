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
   * The `Role access` column said admin — grant the org-admin custom claim.
   * This is the **only** thing that column grants: team leadership is not set
   * by the file, and every membership it writes is a plain `member`.
   */
  orgAdmin: boolean;
  /** The Role access cell verbatim, for the preview. */
  accessRaw: string | null;
  /** Set when the cell was neither admin nor a member synonym — imported as
   *  member and reported, rather than silently flattened. */
  unrecognizedAccess: string | null;
  /** A job title, if the file carries a separate column for one. Display
   *  only — it grants nothing. */
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
  /** True if **any** of this person's rows said admin. */
  orgAdmin: boolean;
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
  /** The file grants this person the org-admin claim. */
  orgAdmin: boolean;
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
   * Org-admin custom claims, by email. `granted` is what this run set,
   * `unchanged` already had it, and `notRevoked` names people who hold the
   * claim while the file calls them a member — the import is additive, so it
   * reports rather than demotes. Revoke with `pnpm admin:set-role --role
   * normal`.
   */
  orgAdmins: { granted: string[]; unchanged: string[]; notRevoked: string[] };
  /**
   * Distinct `Role access` values that were neither admin nor a member
   * synonym. Imported as member; listed so a file meaning something by
   * "Owner" or "Leader" doesn't pass unnoticed.
   */
  unrecognizedAccess: string[];
  /**
   * Teams the file touches that end up with no team leader. `Role access`
   * grants org admin, never team leadership, so every team this import creates
   * starts leaderless — surfaced here so the admin promotes someone instead of
   * discovering it when nobody but an org admin can manage the team.
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
