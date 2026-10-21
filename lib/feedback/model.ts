// Feedback tracker — the pure half: ids, enums, validation, change detection.
// Firestore reads and writes live in lib/firebase/feedback.ts; the seed
// mapping in lib/feedback/seed.ts.
//
// Validation throws a plain Error with a message the form can show, the same
// way requireMaxLength (lib/text-limits.ts) does for every other form.
//
// Pure: no Firestore, no React — safe to import from client components.

import { LONG_TEXT_MAX, TITLE_MAX, requireMaxLength } from "@/lib/text-limits";
import {
  FEEDBACK_BOARD_COLUMNS,
  FEEDBACK_EDITABLE_FIELDS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type FeedbackActivity,
  type FeedbackActivityDoc,
  type FeedbackActivityKind,
  type FeedbackBoardColumn,
  type FeedbackEditableField,
  type FeedbackItem,
  type FeedbackItemDoc,
  type FeedbackPatch,
  type FeedbackStatus,
  type FeedbackType,
} from "./types";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const DOC_ID_RE = /^fb-\d{3,}$/;

/** `fb-007` for item 7. Throws for anything but a positive integer. */
export function feedbackDocId(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`Feedback number must be a positive integer (got ${number})`);
  }
  return `fb-${String(number).padStart(3, "0")}`;
}

export function isFeedbackDocId(id: unknown): id is string {
  return typeof id === "string" && DOC_ID_RE.test(id);
}

/** The label staff see: `FB-007`. */
export function feedbackLabel(number: number): string {
  return feedbackDocId(number).toUpperCase();
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(v);
}

export function isFeedbackType(v: unknown): v is FeedbackType {
  return typeof v === "string" && (FEEDBACK_TYPES as readonly string[]).includes(v);
}

/** The board column a status sits in. Every status has one. */
export function boardColumnFor(status: FeedbackStatus): FeedbackBoardColumn {
  const col = FEEDBACK_BOARD_COLUMNS.find((c) => c.statuses.includes(status));
  if (!col) throw new Error(`No board column for status ${status}`);
  return col;
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

/** Names, page, follow-up person/topic, decision source, branch names. */
export const FEEDBACK_SHORT_TEXT_MAX = 200;
/** One evidence line or follow-up action. */
export const FEEDBACK_LIST_ITEM_MAX = 2_000;
/** Entries per list field (evidence, follow_ups, branches, screenshots, prs). */
export const FEEDBACK_LIST_MAX = 50;

/** Screenshot basenames: no path, an image extension. */
const SCREENSHOT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(png|jpe?g|gif|webp)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function isRealDate(ymd: string): boolean {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

/** Trimmed text, or null when empty. Throws on a non-string or over-long value. */
export function optionalText(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error(`${label} must be text`);
  const t = v.trim();
  requireMaxLength(t, max, label);
  return t || null;
}

/** Trimmed, non-empty text. */
export function requiredText(v: unknown, max: number, label: string): string {
  const t = optionalText(v, max, label);
  if (!t) throw new Error(`${label} is required`);
  return t;
}

/** Trimmed, non-empty, de-duplicated entries in their given order. */
export function textList(v: unknown, itemMax: number, label: string): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${label} must be a list`);
  const out: string[] = [];
  for (const item of v) {
    const t = optionalText(item, itemMax, label);
    if (t && !out.includes(t)) out.push(t);
  }
  if (out.length > FEEDBACK_LIST_MAX) {
    throw new Error(`${label}: at most ${FEEDBACK_LIST_MAX} entries`);
  }
  return out;
}

/** yyyy-mm-dd, a real calendar date. */
export function dateOnly(v: unknown, label: string): string {
  if (typeof v !== "string" || !DATE_RE.test(v.trim()) || !isRealDate(v.trim())) {
    throw new Error(`${label} must be a date (yyyy-mm-dd)`);
  }
  return v.trim();
}

/** `shipped_at`: yyyy-mm-dd or an ISO date-time; null/empty = not shipped. */
export function shippedAt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error("Shipped date must be text");
  const t = v.trim();
  if (!t) return null;
  const ok = DATE_RE.test(t)
    ? isRealDate(t)
    : DATE_TIME_RE.test(t) && isRealDate(t.slice(0, 10)) && !Number.isNaN(Date.parse(t));
  if (!ok) throw new Error("Shipped date must be yyyy-mm-dd or an ISO date-time");
  return t;
}

/** Positive PR numbers, de-duplicated and ascending. */
export function prList(v: unknown): number[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("PRs must be a list");
  const out = new Set<number>();
  for (const n of v) {
    if (!Number.isSafeInteger(n) || (n as number) < 1) {
      throw new Error(`PR numbers must be positive integers (got ${String(n)})`);
    }
    out.add(n as number);
  }
  if (out.size > FEEDBACK_LIST_MAX) throw new Error(`PRs: at most ${FEEDBACK_LIST_MAX} entries`);
  return [...out].sort((a, b) => a - b);
}

/** Screenshot basenames (see SCREENSHOT_RE), de-duplicated. */
export function screenshotList(v: unknown): string[] {
  const names = textList(v, 104, "Screenshot");
  for (const n of names) {
    if (!SCREENSHOT_RE.test(n)) throw new Error(`Screenshot "${n}" must be an image file name`);
  }
  return names;
}

function status(v: unknown): FeedbackStatus {
  if (!isFeedbackStatus(v)) throw new Error(`Unknown status "${String(v)}"`);
  return v;
}

function feedbackType(v: unknown): FeedbackType {
  if (!isFeedbackType(v)) throw new Error(`Unknown type "${String(v)}"`);
  return v;
}

/**
 * Validator per editable field. Each returns the stored (normalized) value.
 * Exported for the seed mapping (lib/feedback/seed.ts), which runs every
 * seed value through the same checks.
 */
export const FEEDBACK_FIELD_VALIDATORS: {
  [K in FeedbackEditableField]: (v: unknown) => FeedbackItemDoc[K];
} = {
  status,
  reported_on: (v) => dateOnly(v, "Reported date"),
  reviewer: (v) => requiredText(v, FEEDBACK_SHORT_TEXT_MAX, "Reported by"),
  page: (v) => requiredText(v, FEEDBACK_SHORT_TEXT_MAX, "Page"),
  type: feedbackType,
  summary: (v) => optionalText(v, TITLE_MAX, "Summary"),
  comment_display: (v) => optionalText(v, LONG_TEXT_MAX, "Display comment"),
  client_resolution: (v) => optionalText(v, LONG_TEXT_MAX, "Resolution for staff"),
  resolution: (v) => optionalText(v, LONG_TEXT_MAX, "Internal resolution"),
  client_note: (v) => optionalText(v, LONG_TEXT_MAX, "Client note"),
  evidence: (v) => textList(v, FEEDBACK_LIST_ITEM_MAX, "Evidence"),
  prs: prList,
  branches: (v) => textList(v, FEEDBACK_SHORT_TEXT_MAX, "Branch"),
  follow_up_with: (v) => optionalText(v, FEEDBACK_SHORT_TEXT_MAX, "Follow up with"),
  follow_up_topic: (v) => optionalText(v, FEEDBACK_SHORT_TEXT_MAX, "Follow-up topic"),
  follow_ups: (v) => textList(v, FEEDBACK_LIST_ITEM_MAX, "Follow-up"),
  decision_source: (v) => optionalText(v, FEEDBACK_SHORT_TEXT_MAX, "Decision source"),
  screenshots: screenshotList,
  shipped_at: shippedAt,
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** What the Log feedback form sends. Everything else starts empty. */
export type NewFeedbackInput = {
  reported_on: unknown;
  reviewer: unknown;
  page: unknown;
  type: unknown;
  original_comment: unknown;
  summary?: unknown;
  screenshots?: unknown;
};

export type NewFeedbackFields = Pick<
  FeedbackItemDoc,
  "reported_on" | "reviewer" | "page" | "type" | "original_comment" | "summary" | "screenshots"
>;

export function validateNewFeedback(input: NewFeedbackInput): NewFeedbackFields {
  const comment = input.original_comment;
  if (typeof comment !== "string" || !comment.trim()) {
    throw new Error("Comment is required");
  }
  requireMaxLength(comment, LONG_TEXT_MAX, "Comment");
  return {
    reported_on: FEEDBACK_FIELD_VALIDATORS.reported_on(input.reported_on),
    reviewer: FEEDBACK_FIELD_VALIDATORS.reviewer(input.reviewer),
    page: FEEDBACK_FIELD_VALIDATORS.page(input.page),
    type: FEEDBACK_FIELD_VALIDATORS.type(input.type),
    // Verbatim: the reporter's words are the record. Only the outer
    // whitespace a textarea adds is dropped.
    original_comment: comment.trim(),
    summary: FEEDBACK_FIELD_VALIDATORS.summary(input.summary),
    screenshots: FEEDBACK_FIELD_VALIDATORS.screenshots(input.screenshots),
  };
}

/** Stored fields minus the timestamps and stamp, which the writer adds. */
export type FeedbackItemBody = Omit<FeedbackItemDoc, "created_at" | "updated_at" | "updated_by">;

/** A new item's body: the form's fields, status `new`, everything else empty. */
export function newFeedbackItem(
  fields: NewFeedbackFields,
  opts: { number: number; createdBy: string },
): FeedbackItemBody {
  return {
    number: opts.number,
    sheet_row: null,
    ...fields,
    comment_display: null,
    client_resolution: null,
    resolution: null,
    client_note: null,
    evidence: [],
    prs: [],
    branches: [],
    follow_up_with: null,
    follow_up_topic: null,
    follow_ups: [],
    decision_source: null,
    thread: null,
    status: "new",
    shipped_at: null,
    created_by: opts.createdBy,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Validate a partial edit. Only FEEDBACK_EDITABLE_FIELDS may appear; an
 * `undefined` value is treated as absent. `original_comment`, `number` and
 * `sheet_row` are refused by name — they are never edited.
 */
export function validateFeedbackPatch(patch: Record<string, unknown>): FeedbackPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!(FEEDBACK_EDITABLE_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`"${key}" cannot be edited`);
    }
    out[key] = FEEDBACK_FIELD_VALIDATORS[key as FeedbackEditableField](value);
  }
  return out as FeedbackPatch;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => x === b[i])
    );
  }
  return (a ?? null) === (b ?? null);
}

/** Patch fields whose value differs from `current`, in FEEDBACK_EDITABLE_FIELDS order. */
export function changedFeedbackFields(
  current: Readonly<Record<string, unknown>>,
  patch: FeedbackPatch,
): FeedbackEditableField[] {
  return FEEDBACK_EDITABLE_FIELDS.filter(
    (f) => Object.hasOwn(patch, f) && !sameValue(current[f], patch[f]),
  );
}

/**
 * The activity row for an edit that changed `changed` (non-empty). A status
 * change is a `status` row with from/to, listing any other fields changed in
 * the same save; anything else is an `edited` row.
 */
export function feedbackEditActivity(
  fromStatus: FeedbackStatus,
  patch: FeedbackPatch,
  changed: readonly FeedbackEditableField[],
  actorUid: string,
): Omit<FeedbackActivityDoc, "at"> {
  const others = changed.filter((f) => f !== "status");
  if (changed.includes("status") && patch.status) {
    return {
      actor_uid: actorUid,
      kind: "status",
      from: fromStatus,
      to: patch.status,
      ...(others.length > 0 ? { fields: others } : {}),
    };
  }
  return { actor_uid: actorUid, kind: "edited", fields: others };
}

/** `created` / `imported` row. */
export function feedbackCreateActivity(
  kind: Extract<FeedbackActivityKind, "created" | "imported">,
  actorUid: string,
  initialStatus: FeedbackStatus,
): Omit<FeedbackActivityDoc, "at"> {
  return { actor_uid: actorUid, kind, to: initialStatus };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** ISO string from a Firestore Timestamp (duck-typed) or a stored string. */
export function timestampIso(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The serializable read model for a stored doc. Lenient: the writers keep the
 * shape, so this only fills defaults — an unknown status reads as `new`
 * rather than failing a page render.
 */
export function readFeedbackItem(id: string, d: Readonly<Record<string, unknown>>): FeedbackItem {
  return {
    id,
    number: typeof d.number === "number" ? d.number : 0,
    sheet_row: typeof d.sheet_row === "number" ? d.sheet_row : null,
    reported_on: typeof d.reported_on === "string" ? d.reported_on : "",
    reviewer: typeof d.reviewer === "string" ? d.reviewer : "",
    page: typeof d.page === "string" ? d.page : "",
    type: isFeedbackType(d.type) ? d.type : "feature",
    summary: strOrNull(d.summary),
    original_comment: typeof d.original_comment === "string" ? d.original_comment : "",
    comment_display: strOrNull(d.comment_display),
    client_resolution: strOrNull(d.client_resolution),
    resolution: strOrNull(d.resolution),
    client_note: strOrNull(d.client_note),
    evidence: strings(d.evidence),
    prs: Array.isArray(d.prs) ? d.prs.filter((n): n is number => Number.isSafeInteger(n)) : [],
    branches: strings(d.branches),
    follow_up_with: strOrNull(d.follow_up_with),
    follow_up_topic: strOrNull(d.follow_up_topic),
    follow_ups: strings(d.follow_ups),
    decision_source: strOrNull(d.decision_source),
    thread: strOrNull(d.thread),
    screenshots: strings(d.screenshots),
    status: isFeedbackStatus(d.status) ? d.status : "new",
    shipped_at: strOrNull(d.shipped_at),
    created_by: strOrNull(d.created_by),
    created_at: timestampIso(d.created_at),
    updated_at: timestampIso(d.updated_at),
    updated_by: strOrNull(d.updated_by),
  };
}

const ACTIVITY_KINDS: readonly FeedbackActivityKind[] = ["created", "status", "edited", "imported"];

export function readFeedbackActivity(
  id: string,
  d: Readonly<Record<string, unknown>>,
): FeedbackActivity {
  return {
    id,
    at: timestampIso(d.at),
    actor_uid: typeof d.actor_uid === "string" ? d.actor_uid : "",
    kind: ACTIVITY_KINDS.find((k) => k === d.kind) ?? "edited",
    ...(isFeedbackStatus(d.from) ? { from: d.from } : {}),
    ...(isFeedbackStatus(d.to) ? { to: d.to } : {}),
    ...(Array.isArray(d.fields)
      ? {
          fields: d.fields.filter((f): f is FeedbackEditableField =>
            (FEEDBACK_EDITABLE_FIELDS as readonly unknown[]).includes(f),
          ),
        }
      : {}),
  };
}
