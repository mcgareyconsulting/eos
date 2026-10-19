// The feedback tracker's server-action logic (ROADMAP N73), kept out of the
// "use server" module (./actions.ts) so it can be tested without a Next
// request: actions.ts only adds revalidatePath.
//
// Every path goes through lib/firebase/feedback.ts, whose functions start
// with requireAdmin(): a non-admin gets the admin pages' 404 (notFound()
// propagates — it is control flow, not a refusal) before anything is read
// or written. Expected refusals — a bad value, a missing item — come back as
// { ok: false, error } with readable text, because a production build masks
// any error thrown from a server action ("Minified React error #441").
// Unexpected failures are logged with their stack and reported generically.

import { unstable_rethrow } from "next/navigation";
import {
  FEEDBACK_NOT_FOUND,
  FEEDBACK_STALE,
  createFeedbackItem,
  updateFeedbackItem,
  type FeedbackDeps,
} from "@/lib/firebase/feedback";
import { requireAdmin } from "@/lib/firebase/teams";
import { bankToday, feedbackEditFormToPatch, withShippedAtFill } from "@/lib/feedback/edit";
import { isFeedbackDocId, validateFeedbackPatch, validateNewFeedback } from "@/lib/feedback/model";
import type { FeedbackEditableField, FeedbackPatch } from "@/lib/feedback/types";

export type FeedbackActionDeps = FeedbackDeps & { now?: () => Date };

export type FeedbackSaveResult =
  | { ok: true; changed: FeedbackEditableField[] }
  | { ok: false; error: string };

export type FeedbackCreateResult =
  | { ok: true; id: string; number: number }
  | { ok: false; error: string };

export const GENERIC_FEEDBACK_ERROR =
  "The change could not be saved. Try again; if it keeps failing, tell Daniel and mention the time.";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function logFailure(event: string, id: string | null, e: unknown) {
  console.error(
    JSON.stringify({
      event,
      id,
      message: message(e),
      stack: e instanceof Error ? e.stack : undefined,
    }),
  );
}

/**
 * Validate `buildPatch`, then save it through updateFeedbackItem with the
 * shipped_at fill applied inside its transaction (against the snapshot the
 * write is based on). Shared by the detail form and the board's select.
 * `expectedUpdatedAt` (undefined = no check) refuses a save made from a
 * form opened before someone else's save.
 */
async function saveFeedback(
  id: unknown,
  buildPatch: () => FeedbackPatch,
  expectedUpdatedAt: string | null | undefined,
  deps: FeedbackActionDeps,
): Promise<FeedbackSaveResult> {
  // The gate first, whatever the input: a non-admin always gets the 404 and
  // never reaches validation, so even the refusal wording is admin-only.
  await requireAdmin(deps);
  if (!isFeedbackDocId(id)) return { ok: false, error: FEEDBACK_NOT_FOUND };

  let patch: FeedbackPatch;
  try {
    patch = buildPatch();
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  const today = bankToday((deps.now ?? (() => new Date()))());

  try {
    const { changed } = await updateFeedbackItem(id, patch, deps, {
      expectedUpdatedAt,
      prepare: (current, p) => withShippedAtFill(current, p, today),
    });
    return { ok: true, changed };
  } catch (e) {
    unstable_rethrow(e);
    const m = message(e);
    if (m === FEEDBACK_NOT_FOUND || m === FEEDBACK_STALE) return { ok: false, error: m };
    logFailure("feedback_save_failed", id, e);
    return { ok: false, error: GENERIC_FEEDBACK_ERROR };
  }
}

/**
 * The detail page's Edit dialog: only the fields the admin changed
 * (lib/feedback/edit.ts changedEditFields), plus the item's updated_at as the
 * dialog loaded it — required, so a save over someone else's newer change is
 * refused rather than silently reverting it.
 */
export function saveFeedbackEditsCore(
  id: unknown,
  form: unknown,
  openedUpdatedAt: unknown,
  deps: FeedbackActionDeps = {},
): Promise<FeedbackSaveResult> {
  return saveFeedback(
    id,
    () => {
      if (!form || typeof form !== "object") throw new Error("Nothing to save");
      if (openedUpdatedAt !== null && typeof openedUpdatedAt !== "string") {
        throw new Error(FEEDBACK_STALE);
      }
      return feedbackEditFormToPatch(form as Record<string, unknown>);
    },
    openedUpdatedAt === null || typeof openedUpdatedAt === "string" ? openedUpdatedAt : null,
    deps,
  );
}

/** The board card's status select. */
export function setFeedbackStatusCore(
  id: unknown,
  status: unknown,
  deps: FeedbackActionDeps = {},
): Promise<FeedbackSaveResult> {
  // No staleness check: the board writes only the status (and the fill),
  // so it cannot revert anyone else's field.
  return saveFeedback(id, () => validateFeedbackPatch({ status }), undefined, deps);
}

/** The Log feedback form (text only; no upload in v1). */
export async function createFeedbackCore(
  input: unknown,
  deps: FeedbackActionDeps = {},
): Promise<FeedbackCreateResult> {
  // createFeedbackItem gates too, but the gate must come before validation
  // here so a non-admin never sees a validation message.
  await requireAdmin(deps);

  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fields = {
    reported_on: raw.reported_on,
    reviewer: raw.reviewer,
    page: raw.page,
    type: raw.type,
    summary: raw.summary,
    original_comment: raw.original_comment,
  };
  try {
    validateNewFeedback(fields);
  } catch (e) {
    return { ok: false, error: message(e) };
  }

  try {
    const { id, number } = await createFeedbackItem(fields, deps);
    return { ok: true, id, number };
  } catch (e) {
    unstable_rethrow(e);
    logFailure("feedback_create_failed", null, e);
    return {
      ok: false,
      error: "The item could not be logged. Try again; if it keeps failing, tell Daniel and mention the time.",
    };
  }
}
