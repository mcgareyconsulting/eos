// Feedback tracker — seed mapping (docs/feedback/feedback-tracker-seed.json →
// feedback_items docs). Pure; scripts/import-feedback-seed.ts does the I/O.
//
// Every value goes through the same validators the app's own writes use
// (lib/feedback/model.ts), so an imported item is indistinguishable from one
// saved in the app.
//
// Seed fields NOT carried over (the seed file stays in the repo, keyed by
// `sheet_row`, for anything they held):
//   question_for_daniel, confidence  — triage notes for the seeding pass
//   sheet_note                       — spreadsheet cell notes
//   deployed_note, phase             — one-off notes on 1–2 items
//   work.state / before_release / updated — branch bookkeeping
// `work.prs` and `work.branches` become `prs` / `branches`; `thread` (the
// reviewer reply history, one line of text) is carried over read-only.

import { requireMaxLength, LONG_TEXT_MAX } from "@/lib/text-limits";
import {
  FEEDBACK_FIELD_VALIDATORS as V,
  feedbackDocId,
  optionalText,
  type FeedbackItemBody,
} from "./model";

/** One record of the seed file, as loosely as it is written. */
export type FeedbackSeedRecord = Readonly<Record<string, unknown>>;

export type MappedSeed =
  | { ok: true; id: string; item: FeedbackItemBody }
  | { ok: false; label: string; error: string };

/** `PR #18`, `PRs #90 and #93`, `PR #86, #88`. */
const PR_RUN_RE = /\bPRs?\s+#\d+(?:\s*(?:,|and|&)\s*#\d+)*/g;

/** PR numbers an evidence line cites (only after "PR"/"PRs", so "Pass 14 #6" is not one). */
export function prsInEvidence(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    for (const run of line.match(PR_RUN_RE) ?? []) {
      for (const m of run.matchAll(/#(\d+)/g)) out.push(Number(m[1]));
    }
  }
  return out;
}

/** `screenshots/row02.png` → `row02.png`. */
export function screenshotBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The seed's `thread`: reviewer reply history, one string. Not an editable
 * field, so it has no FEEDBACK_FIELD_VALIDATORS entry — same text rules as
 * the other long notes.
 */
export function seedThread(v: unknown): string | null {
  return optionalText(v, LONG_TEXT_MAX, "thread");
}

function work(rec: FeedbackSeedRecord): { prs: unknown[]; branches: unknown[] } {
  const w = rec.work as { prs?: unknown; branches?: unknown } | null | undefined;
  return {
    prs: Array.isArray(w?.prs) ? w.prs : [],
    branches: Array.isArray(w?.branches) ? w.branches : [],
  };
}

/** Map one seed record, or say why it cannot be imported. */
export function mapSeedRecord(rec: FeedbackSeedRecord): MappedSeed {
  const label = `number ${String(rec.number)} (row ${String(rec.row)})`;
  try {
    const number = rec.number;
    if (typeof number !== "number") throw new Error("number is missing");
    const id = feedbackDocId(number);
    if (!Number.isSafeInteger(rec.row) || (rec.row as number) < 1) {
      throw new Error("row must be a positive integer");
    }
    const comment = rec.original_comment;
    if (typeof comment !== "string" || !comment.trim()) {
      throw new Error("original_comment is required");
    }
    requireMaxLength(comment, LONG_TEXT_MAX, "original_comment");
    const evidence = V.evidence(rec.evidence);
    const w = work(rec);
    const item: FeedbackItemBody = {
      number,
      sheet_row: rec.row as number,
      reported_on: V.reported_on(rec.reported_on),
      reviewer: V.reviewer(rec.reviewer),
      page: V.page(rec.page),
      type: V.type(rec.type),
      summary: V.summary(rec.summary),
      // Verbatim, untrimmed: the spreadsheet cell as it was.
      original_comment: comment,
      comment_display: V.comment_display(rec.comment_display),
      client_resolution: V.client_resolution(rec.resolution_ste),
      resolution: V.resolution(rec.resolution),
      client_note: V.client_note(rec.client_note),
      evidence,
      prs: V.prs([...w.prs, ...prsInEvidence(evidence)]),
      branches: V.branches(w.branches),
      follow_up_with: V.follow_up_with(rec.follow_up_with),
      follow_up_topic: V.follow_up_topic(rec.follow_up_topic),
      follow_ups: V.follow_ups(rec.follow_ups),
      decision_source: V.decision_source(rec.decision_source),
      thread: seedThread(rec.thread),
      screenshots: V.screenshots(
        Array.isArray(rec.screenshots)
          ? rec.screenshots.map((s) => (typeof s === "string" ? screenshotBasename(s) : s))
          : rec.screenshots,
      ),
      status: V.status(rec.status),
      shipped_at: V.shipped_at(rec.shipped_at),
      created_by: null,
    };
    return { ok: true, id, item };
  } catch (e) {
    return { ok: false, label, error: e instanceof Error ? e.message : String(e) };
  }
}

export type SeedImportPlan = {
  create: { id: string; item: FeedbackItemBody }[];
  /** Already in the database: never overwritten (edits made in the app win). */
  skip: string[];
  invalid: { label: string; error: string }[];
};

/** Sort the seed into create / skip (id exists) / invalid (incl. a repeated number). */
export function planSeedImport(
  records: readonly FeedbackSeedRecord[],
  existingIds: ReadonlySet<string>,
): SeedImportPlan {
  const plan: SeedImportPlan = { create: [], skip: [], invalid: [] };
  const seen = new Set<string>();
  for (const rec of records) {
    const m = mapSeedRecord(rec);
    if (!m.ok) {
      plan.invalid.push({ label: m.label, error: m.error });
    } else if (seen.has(m.id)) {
      plan.invalid.push({ label: m.id, error: "number repeated in the seed file" });
    } else {
      seen.add(m.id);
      if (existingIds.has(m.id)) plan.skip.push(m.id);
      else plan.create.push({ id: m.id, item: m.item });
    }
  }
  return plan;
}
