// Feedback tracker — the edit form's text → a validated patch, and the
// shipped_at fill rule. Used by the server actions
// (app/(app)/admin/feedback/action-core.ts); the client only sends text.
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

/**
 * PR numbers from free text: "40, #86 93" → [40, 86, 93]. Separators are
 * commas and whitespace; a leading # is optional. Anything else is refused,
 * so a typo is reported rather than dropped.
 */
export function parsePrText(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[\s,]+/).filter((t) => t !== "")) {
    const m = /^#?(\d{1,7})$/.exec(tok);
    if (!m || Number(m[1]) < 1) {
      throw new Error(`"${tok}" is not a PR number`);
    }
    out.push(Number(m[1]));
  }
  return out;
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
  /** "40, 86" — see parsePrText. */
  prs: string;
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
  "prs",
  "evidence",
  "shipped_at",
] as const satisfies readonly (keyof FeedbackEditForm)[];

function text(v: unknown, label: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Error(`${label} must be text`);
  return v;
}

/**
 * The form → a validated patch. Only the form's own fields are read; any
 * other key in `form` is ignored (the action's input is untrusted). Throws
 * a readable Error for a bad value.
 */
export function feedbackEditFormToPatch(form: Readonly<Record<string, unknown>>): FeedbackPatch {
  const t = (k: (typeof FEEDBACK_EDIT_FORM_FIELDS)[number]) => text(form[k], k);
  return validateFeedbackPatch({
    status: t("status"),
    client_resolution: t("client_resolution"),
    resolution: t("resolution"),
    client_note: t("client_note"),
    follow_up_with: t("follow_up_with"),
    follow_up_topic: t("follow_up_topic"),
    follow_ups: parseLines(t("follow_ups")),
    prs: parsePrText(t("prs")),
    evidence: parseLines(t("evidence")),
    shipped_at: t("shipped_at"),
  });
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
    prs: item.prs.join(", "),
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
