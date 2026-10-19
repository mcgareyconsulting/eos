// Feedback tracker — the edit form's text → a validated patch, and the
// shipped_at fill rule. Used by the server actions
// (app/(app)/admin/feedback/action-core.ts); the client only sends text.
//
// PR numbers stay in the model, the seed and the database, but the UI
// neither shows nor edits them while the repository moves hosts.
//
// Pure: no Firestore, no React — safe to import from client components.

import { calendarDateIn, APP_TIME_ZONE } from "@/lib/time-zone";
import { validateFeedbackPatch } from "./model";
import type { FeedbackItem, FeedbackPatch, FeedbackStatus } from "./types";

/** Statuses whose arrival stamps `shipped_at` when it is still empty. */
export const SHIPPED_STATUSES: readonly FeedbackStatus[] = ["deployed", "completed"];

/** One entry per non-blank line (the list fields' textareas). */
export function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** What the edit form sends: text fields as typed, lists one per line. */
export type FeedbackEditForm = {
  status: string;
  client_resolution: string;
  resolution: string;
  client_note: string;
  follow_up_with: string;
  follow_up_topic: string;
  /** One follow-up per line. */
  follow_ups: string;
  /** One evidence line per line. */
  evidence: string;
  /** yyyy-mm-dd, or empty. */
  shipped_at: string;
};

export const FEEDBACK_EDIT_FORM_FIELDS = [
  "status",
  "client_resolution",
  "resolution",
  "client_note",
  "follow_up_with",
  "follow_up_topic",
  "follow_ups",
  "evidence",
  "shipped_at",
] as const satisfies readonly (keyof FeedbackEditForm)[];

function text(v: unknown, label: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Error(`${label} must be text`);
  return v;
}

/**
 * The form → a validated patch. Only the form's own fields are read, and
 * only those PRESENT in `form` (the dialog sends just the fields the admin
 * changed, so a concurrent edit to another field is never written back).
 * Any other key is ignored (the action's input is untrusted). Throws a
 * readable Error for a bad value.
 */
export function feedbackEditFormToPatch(form: Readonly<Record<string, unknown>>): FeedbackPatch {
  const parse: Record<(typeof FEEDBACK_EDIT_FORM_FIELDS)[number], (t: string) => unknown> = {
    status: (t) => t,
    client_resolution: (t) => t,
    resolution: (t) => t,
    client_note: (t) => t,
    follow_up_with: (t) => t,
    follow_up_topic: (t) => t,
    follow_ups: parseLines,
    evidence: parseLines,
    shipped_at: (t) => t,
  };
  const raw: Record<string, unknown> = {};
  for (const k of FEEDBACK_EDIT_FORM_FIELDS) {
    if (!Object.hasOwn(form, k) || form[k] === undefined) continue;
    raw[k] = parse[k](text(form[k], k));
  }
  return validateFeedbackPatch(raw);
}

/** The fields of `draft` that differ from `opened` — what the dialog sends. */
export function changedEditFields(
  draft: FeedbackEditForm,
  opened: FeedbackEditForm,
): Partial<FeedbackEditForm> {
  const out: Partial<FeedbackEditForm> = {};
  for (const k of FEEDBACK_EDIT_FORM_FIELDS) if (draft[k] !== opened[k]) out[k] = draft[k];
  return out;
}

/** The edit form's opening values for an item. */
export function feedbackEditFormFrom(item: FeedbackItem): FeedbackEditForm {
  return {
    status: item.status,
    client_resolution: item.client_resolution ?? "",
    resolution: item.resolution ?? "",
    client_note: item.client_note ?? "",
    follow_up_with: item.follow_up_with ?? "",
    follow_up_topic: item.follow_up_topic ?? "",
    follow_ups: item.follow_ups.join("\n"),
    evidence: item.evidence.join("\n"),
    shipped_at: item.shipped_at ?? "",
  };
}

/** Today on the bank's clock (America/Denver), yyyy-mm-dd. */
export function bankToday(now: Date = new Date()): string {
  return calendarDateIn(now, APP_TIME_ZONE);
}

/**
 * The shipped_at fill rule: when this save moves the status to Deployed or
 * Completed (from anything else) and shipped_at would be empty after it,
 * shipped_at becomes `today`. Otherwise the patch is returned as is — an
 * admin's own date always wins, and the field stays editable afterwards.
 */
export function withShippedAtFill(
  current: Pick<FeedbackItem, "status" | "shipped_at">,
  patch: FeedbackPatch,
  today: string,
): FeedbackPatch {
  const to = patch.status;
  if (!to || to === current.status || !SHIPPED_STATUSES.includes(to)) return patch;
  const after = Object.hasOwn(patch, "shipped_at") ? patch.shipped_at : current.shipped_at;
  if (after) return patch;
  return { ...patch, shipped_at: today };
}
