// Keeping `issues/{id}.comment_count` in step with the issue's thread (Admin
// SDK; server only) — the write half of lib/issue-comment-count.ts, called by
// the comment actions (entity-comments/actions.ts).
//
// Each helper runs one transaction that writes the comment change and the
// issue's new count together, so the counter never runs ahead of or behind
// the thread, and two deletes of the same comment count once.
//
// Self-correcting: an issue written before the counter shipped has no
// `comment_count`. Rather than start it at ±1, the first post or delete on
// such an issue recounts the thread inside the transaction and stores the
// true size. A stored count is never written below 0.
//
// Not stamped: the counter write deliberately leaves `updated_by` /
// `updated_at` alone. The issue detail feed (issues/issue-events.ts
// actorAt) names the person behind solved / dropped / archived only while
// `updated_at` still equals that event's time, so stamping the issue here
// would turn those into "Someone" after any comment. The audited user action
// is the comment doc, which carries its own stamp; the audit row for the
// issue's counter change has actor_uid null (lib/audit-actor.ts — no fresh
// stamp, so it is not pinned on the issue's last editor either), the same
// as the backfill script's writes.

import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { ISSUE_COMMENT_COUNT_FIELD } from "@/lib/issue-comment-count";

/**
 * The issue's comments as the thread holds them now, read in `tx`. By
 * `entity_id` alone (as lib/firebase/purge.ts and the backfill read threads),
 * so no composite index is needed; the type is checked in code.
 */
async function threadSize(
  tx: Transaction,
  db: Firestore,
  issueId: string,
  excludeId?: string,
): Promise<number> {
  const thread = await tx.get(
    db.collection("entity_comments").where("entity_id", "==", issueId),
  );
  return thread.docs.filter(
    (d) => d.data().entity_type === "issue" && d.id !== excludeId,
  ).length;
}

function storedCount(data: DocumentData | undefined): number | null {
  const n = data?.[ISSUE_COMMENT_COUNT_FIELD];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Create the comment at `commentRef` and count it on the issue. An issue
 * that is gone (deleted between the access check and now) gets no counter;
 * the comment is still written, as it was before the counter existed.
 */
export async function postIssueComment(
  db: Firestore,
  commentRef: DocumentReference,
  comment: DocumentData,
  issueId: string,
): Promise<void> {
  const issueRef = db.collection("issues").doc(issueId);
  await db.runTransaction(async (tx) => {
    const issue = await tx.get(issueRef);
    let next: number | null = null;
    if (issue.exists) {
      const stored = storedCount(issue.data());
      // The new comment is not in the thread yet, so the recount is "before".
      const before = stored ?? (await threadSize(tx, db, issueId));
      next = Math.max(0, Math.floor(before)) + 1;
    }
    tx.create(commentRef, comment);
    if (next !== null) tx.update(issueRef, { [ISSUE_COMMENT_COUNT_FIELD]: next });
  });
}

/**
 * Delete the comment at `commentRef` and take it off the issue's count.
 * Returns false when the comment was already gone (nothing deleted, count
 * untouched). An issue already gone (deleteIssue purges the thread after the
 * issue) has no counter to keep, so only the comment is deleted.
 */
export async function deleteIssueComment(
  db: Firestore,
  commentRef: DocumentReference,
  issueId: string,
): Promise<boolean> {
  const issueRef = issueId ? db.collection("issues").doc(issueId) : null;
  return db.runTransaction(async (tx) => {
    const [comment, issue] = await Promise.all([
      tx.get(commentRef),
      issueRef ? tx.get(issueRef) : Promise.resolve(null),
    ]);
    if (!comment.exists) return false;
    let next: number | null = null;
    if (issueRef && issue?.exists) {
      const stored = storedCount(issue.data());
      next =
        stored === null
          ? await threadSize(tx, db, issueId, commentRef.id)
          : Math.max(0, Math.floor(stored) - 1);
    }
    tx.delete(commentRef);
    if (issueRef && next !== null) {
      tx.update(issueRef, { [ISSUE_COMMENT_COUNT_FIELD]: next });
    }
    return true;
  });
}
