// Feedback tracker (ROADMAP N73) — the Firestore half (Admin SDK; server only).
// Pure model, validation and change detection: lib/feedback/model.ts.
//
// Access-list only, enforced HERE: every export starts with
// requireFeedbackTrackerAccess() (lib/firebase/feedback-access.ts — the
// dedicated list in app_config/feedback_tracker, not the org-admin role), so
// a server action or page that calls in cannot forget the gate; anyone not
// listed gets the same 404 as every admin surface. The client rules
// (firestore.rules `feedback_items`) let no client read or write: the tracker
// is served from the server only.
//
// Every write is one transaction that changes the item and appends its
// `feedback_items/{id}/activity/{auto}` row, so the trace cannot miss or
// invent a change. The item carries the C-07 stamp (lib/audit-stamp.ts) for
// the audit trigger; the activity rows do not — the trigger only watches
// top-level collections, and each row names its actor in `actor_uid`.

import { FieldValue } from "firebase-admin/firestore";
import { stamp } from "@/lib/audit-stamp";
import {
  changedFeedbackFields,
  feedbackCreateActivity,
  feedbackDocId,
  feedbackEditActivity,
  isFeedbackDocId,
  newFeedbackItem,
  readFeedbackActivity,
  readFeedbackItem,
  validateFeedbackPatch,
  validateNewFeedback,
  type NewFeedbackInput,
} from "@/lib/feedback/model";
import {
  FEEDBACK_ACTIVITY_COLLECTION,
  FEEDBACK_COLLECTION,
  type FeedbackActivity,
  type FeedbackEditableField,
  type FeedbackItem,
  type FeedbackItemDoc,
  type FeedbackPatch,
} from "@/lib/feedback/types";
import { requireFeedbackTrackerAccess, type FeedbackDeps } from "./feedback-access";

export type { FeedbackDeps };

export const FEEDBACK_NOT_FOUND = "Feedback item not found.";
export const FEEDBACK_STALE = "This item changed since you opened it. Reload to see the latest.";

export type FeedbackUpdateOptions = {
  /**
   * Optimistic concurrency: the item's `updated_at` (ISO, as read by
   * readFeedbackItem) that the caller's form was built from. When the stored
   * value differs inside the transaction — someone saved since — the update
   * throws FEEDBACK_STALE and writes nothing. Undefined = no check.
   */
  expectedUpdatedAt?: string | null;
  /**
   * Adjust the validated patch against the item as read INSIDE the
   * transaction (e.g. the shipped_at fill), so the rule sees the same
   * snapshot the write is based on. The result is validated again.
   */
  prepare?: (current: FeedbackItem, patch: FeedbackPatch) => FeedbackPatch;
};

/** Every item, by number. */
export async function listFeedbackItems(deps: FeedbackDeps = {}): Promise<FeedbackItem[]> {
  const { db } = await requireFeedbackTrackerAccess(deps);
  const snap = await db.collection(FEEDBACK_COLLECTION).orderBy("number").get();
  return snap.docs.map((d) => readFeedbackItem(d.id, d.data()));
}

/** One item, or null (also for an id that is not a feedback id). */
export async function getFeedbackItem(
  id: string,
  deps: FeedbackDeps = {},
): Promise<FeedbackItem | null> {
  const { db } = await requireFeedbackTrackerAccess(deps);
  if (!isFeedbackDocId(id)) return null;
  const snap = await db.collection(FEEDBACK_COLLECTION).doc(id).get();
  return snap.exists ? readFeedbackItem(snap.id, snap.data() ?? {}) : null;
}

/** An item's activity trace, oldest first. Empty for an unknown id. */
export async function listFeedbackActivity(
  id: string,
  deps: FeedbackDeps = {},
): Promise<FeedbackActivity[]> {
  const { db } = await requireFeedbackTrackerAccess(deps);
  if (!isFeedbackDocId(id)) return [];
  const snap = await db
    .collection(FEEDBACK_COLLECTION)
    .doc(id)
    .collection(FEEDBACK_ACTIVITY_COLLECTION)
    .orderBy("at")
    .get();
  return snap.docs.map((d) => readFeedbackActivity(d.id, d.data()));
}

/**
 * Log a new item: status `new`, number = highest existing + 1. The doc id is
 * derived from the number and written with create(), so two admins logging at
 * once can never overwrite each other: at worst the second save fails
 * (contention, or ALREADY_EXISTS) and is simply retried.
 */
export async function createFeedbackItem(
  input: NewFeedbackInput,
  deps: FeedbackDeps = {},
): Promise<{ id: string; number: number }> {
  const { db, uid } = await requireFeedbackTrackerAccess(deps);
  const fields = validateNewFeedback(input);
  const col = db.collection(FEEDBACK_COLLECTION);

  return db.runTransaction(async (tx) => {
    const last = await tx.get(col.orderBy("number", "desc").limit(1));
    const top = last.docs[0]?.data().number;
    const number = (typeof top === "number" ? top : 0) + 1;
    const id = feedbackDocId(number);
    const ref = col.doc(id);
    const item = newFeedbackItem(fields, { number, createdBy: uid });
    tx.create(ref, { ...item, created_at: FieldValue.serverTimestamp(), ...stamp(uid) });
    tx.set(ref.collection(FEEDBACK_ACTIVITY_COLLECTION).doc(), {
      ...feedbackCreateActivity("created", uid, item.status),
      at: FieldValue.serverTimestamp(),
    });
    return { id, number };
  });
}

/**
 * Apply a partial edit (any FEEDBACK_EDITABLE_FIELDS; status may move to any
 * status). Writes only the fields whose value actually changes; a save that
 * changes nothing writes nothing and logs nothing. Returns the changed
 * fields. Throws FEEDBACK_NOT_FOUND for a missing item, FEEDBACK_STALE when
 * `opts.expectedUpdatedAt` no longer matches.
 */
export async function updateFeedbackItem(
  id: string,
  patch: Record<string, unknown>,
  deps: FeedbackDeps = {},
  opts: FeedbackUpdateOptions = {},
): Promise<{ changed: FeedbackEditableField[] }> {
  const { db, uid } = await requireFeedbackTrackerAccess(deps);
  if (!isFeedbackDocId(id)) throw new Error(FEEDBACK_NOT_FOUND);
  const valid = validateFeedbackPatch(patch);
  const ref = db.collection(FEEDBACK_COLLECTION).doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(FEEDBACK_NOT_FOUND);
    const current = readFeedbackItem(snap.id, snap.data() ?? {});
    if (opts.expectedUpdatedAt !== undefined && current.updated_at !== opts.expectedUpdatedAt) {
      throw new Error(FEEDBACK_STALE);
    }
    const final = opts.prepare ? validateFeedbackPatch(opts.prepare(current, valid)) : valid;
    const changed = changedFeedbackFields(current, final);
    if (changed.length === 0) return { changed };

    const update: Partial<FeedbackItemDoc> = {};
    for (const f of changed) (update as Record<string, unknown>)[f] = final[f];
    tx.update(ref, { ...update, ...stamp(uid) });
    tx.set(ref.collection(FEEDBACK_ACTIVITY_COLLECTION).doc(), {
      ...feedbackEditActivity(current.status, final, changed, uid),
      at: FieldValue.serverTimestamp(),
    });
    return { changed };
  });
}
