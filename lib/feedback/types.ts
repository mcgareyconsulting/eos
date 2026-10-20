// Feedback tracker (ROADMAP N73) — stored shapes and enums.
//
// Restricted: HPB staff feedback on the app itself (bugs, requests,
// questions), seeded from the HPB feedback spreadsheet
// (docs/feedback/feedback-tracker-seed.json, scripts/import-feedback-seed.ts)
// and worked in the app afterwards. Only org admins and the people on the
// tracker's access list (app_config/feedback_tracker; lib/feedback/access.ts)
// can open it. No client reads or writes it (firestore.rules
// `feedback_items`); every read and write is a server-side call into
// lib/firebase/feedback.ts, which checks the access list itself.
//
// Pure: no Firestore, no React — safe to import from client components.

export const FEEDBACK_COLLECTION = "feedback_items";
/** `feedback_items/{id}/activity/{auto}` — one row per write (FeedbackActivityDoc). */
export const FEEDBACK_ACTIVITY_COLLECTION = "activity";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle. Any status may move to any other in v1. There is no `closed`:
 * Answered and Completed share the board's Done column instead.
 */
export const FEEDBACK_STATUSES = [
  "new",
  "building",
  "deployed",
  "completed",
  "answered",
  "follow_up",
  "postponed",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  building: "Building",
  deployed: "Deployed",
  completed: "Completed",
  answered: "Answered",
  follow_up: "Follow-up",
  postponed: "Postponed",
};

export type FeedbackBoardColumn = {
  id: string;
  label: string;
  /** The statuses shown in this column. Every status is in exactly one. */
  statuses: readonly FeedbackStatus[];
};

/** Kanban columns, left to right: New · Building · Deployed · Follow-up · Postponed · Done. */
export const FEEDBACK_BOARD_COLUMNS: readonly FeedbackBoardColumn[] = [
  { id: "new", label: "New", statuses: ["new"] },
  { id: "building", label: "Building", statuses: ["building"] },
  { id: "deployed", label: "Deployed", statuses: ["deployed"] },
  { id: "follow_up", label: "Follow-up", statuses: ["follow_up"] },
  { id: "postponed", label: "Postponed", statuses: ["postponed"] },
  { id: "done", label: "Done", statuses: ["completed", "answered"] },
];

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** The four kinds the spreadsheet used. */
export const FEEDBACK_TYPES = ["bug", "feature", "question", "ux"] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature",
  question: "Question",
  ux: "UX",
};

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

/**
 * Stored shape of `feedback_items/{id}`. The id is `fb-<number, 3 digits>`
 * (feedbackDocId), so the seed import is idempotent and a link to FB-037
 * stays stable.
 */
export type FeedbackItemDoc = {
  /** Client-facing number, 1-based (FB-001…). New items take max + 1. */
  number: number;
  /** Row on the original spreadsheet (number + 1); null for items logged in the app. */
  sheet_row: number | null;
  /** yyyy-mm-dd. */
  reported_on: string;
  /** Who reported it, as a display name (reporters are not always app users). */
  reviewer: string;
  /** App area, e.g. "Scorecard". Free text; the seed's values are the usual set. */
  page: string;
  type: FeedbackType;
  /** One-line restatement; null until someone writes one. */
  summary: string | null;
  /** The reporter's words, verbatim. Written once at create; never edited. */
  original_comment: string;
  /** original_comment lightly cleaned for display (typos, casing); null = show the original. */
  comment_display: string | null;
  /** Client-facing resolution — what HPB staff read (the seed's `resolution_ste`). */
  client_resolution: string | null;
  /** Internal resolution note — tracker only, never in the client report. */
  resolution: string | null;
  /** Longer client-facing explanation. */
  client_note: string | null;
  /** Where the fix is: PRs, file paths, roadmap rows. */
  evidence: string[];
  /** Linked GitHub PR numbers, ascending. */
  prs: number[];
  branches: string[];
  /** Who to ask, e.g. "Steph/Jenna". */
  follow_up_with: string | null;
  /** Groups items that share one follow-up conversation, e.g. "links-and-attachments". */
  follow_up_topic: string | null;
  /** Open follow-up actions, one per entry. */
  follow_ups: string[];
  /** Who decided the current status, e.g. "Daniel, 2026-10-15". */
  decision_source: string | null;
  /**
   * Reviewer reply history carried over from the spreadsheet (the seed's
   * `thread`), e.g. "Steph 9/2: added new items from meeting." Read-only:
   * set once by the import, never in FEEDBACK_EDITABLE_FIELDS; null for
   * items logged in the app.
   */
  thread: string | null;
  /** Screenshot file basenames, e.g. "row02.png" (docs/feedback/screenshots for seeded items). */
  screenshots: string[];
  status: FeedbackStatus;
  /** When the fix shipped: yyyy-mm-dd or an ISO date-time; null when not shipped. */
  shipped_at: string | null;
  /** Creating admin's uid; null for imported items. */
  created_by: string | null;
  created_at: unknown;
  /** C-07 stamp (lib/audit-stamp.ts). Absent on items imported without --actor. */
  updated_by?: string;
  updated_at: unknown;
};

/** Fields an admin may change after create. Never number, sheet_row, original_comment, thread. */
export const FEEDBACK_EDITABLE_FIELDS = [
  "status",
  "reported_on",
  "reviewer",
  "page",
  "type",
  "summary",
  "comment_display",
  "client_resolution",
  "resolution",
  "client_note",
  "evidence",
  "prs",
  "branches",
  "follow_up_with",
  "follow_up_topic",
  "follow_ups",
  "decision_source",
  "screenshots",
  "shipped_at",
] as const satisfies readonly (keyof FeedbackItemDoc)[];

export type FeedbackEditableField = (typeof FEEDBACK_EDITABLE_FIELDS)[number];

export type FeedbackPatch = Partial<Pick<FeedbackItemDoc, FeedbackEditableField>>;

export type FeedbackActivityKind = "created" | "status" | "edited" | "imported";

/**
 * Stored shape of `feedback_items/{id}/activity/{auto}`. Written in the same
 * transaction as the change it records.
 */
export type FeedbackActivityDoc = {
  at: unknown;
  /** The acting admin; SYSTEM_ACTOR_ID for an import run without --actor. */
  actor_uid: string;
  kind: FeedbackActivityKind;
  /** kind "status": the old and new status. */
  from?: FeedbackStatus;
  to?: FeedbackStatus;
  /** kind "edited" / "status": the other fields this write changed. */
  fields?: FeedbackEditableField[];
};

// ---------------------------------------------------------------------------
// Read model (what lib/firebase/feedback.ts returns — serializable)
// ---------------------------------------------------------------------------

export type FeedbackItem = Omit<
  FeedbackItemDoc,
  "created_at" | "updated_at" | "updated_by"
> & {
  id: string;
  /** ISO date-time, or null when the server timestamp is unreadable. */
  created_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type FeedbackActivity = Omit<FeedbackActivityDoc, "at"> & {
  id: string;
  at: string | null;
};
