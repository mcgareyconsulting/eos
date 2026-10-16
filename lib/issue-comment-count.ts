// The comment counter on an issue row (feedback row 35): how many comments
// the issue's thread holds, shown on the Issues page and the L10 Issues
// segment so nobody has to open every issue to find the ones with a thread.
//
// Stored on the issue doc as `comment_count` and kept in step with the thread
// by the comment actions (entity-comments/actions.ts): a post increments it in
// the same batch that creates the comment, a delete decrements it in the same
// transaction that removes it. Both lists already ride a live listener on
// `issues`, so the counter updates in place with no extra query. Clients
// cannot write it (firestore.rules denies every client write).
//
// The count reveals nothing the viewer cannot read: an issue's thread is
// readable by exactly the people who can read the issue (lib/access
// team-item canSee = canComment; firestore.rules threadSee → teamItemSeeById).
//
// scripts/backfill-issue-comment-counts.ts recounts existing threads.

export const ISSUE_COMMENT_COUNT_FIELD = "comment_count";

/**
 * The count to show for an issue: a non-negative integer. A doc written
 * before the counter existed has no field (0 until backfilled), and a
 * decrement that raced past zero must never render as "-1".
 */
export function commentCountOf(issue: { comment_count?: unknown } | null | undefined): number {
  const n = issue?.comment_count;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** "3 comments" / "1 comment" — the indicator's tooltip and accessible name. */
export function commentCountLabel(n: number): string {
  return `${n} comment${n === 1 ? "" : "s"}`;
}

export type CommentCountPlan = {
  issueId: string;
  /** The stored value as-is (undefined when the field is missing). */
  before: unknown;
  after: number;
};

/**
 * The backfill's plan: for every issue, the number of `entity_comments` rows
 * with `entity_type == "issue"` and its id, and whether the stored value
 * differs. Comments whose issue no longer exists are counted in `orphans`
 * and written nowhere.
 */
export function planCommentCountBackfill(
  issues: readonly { id: string; data: Record<string, unknown> }[],
  comments: readonly Record<string, unknown>[],
): { writes: CommentCountPlan[]; unchanged: number; orphans: number } {
  const counts = new Map<string, number>();
  for (const c of comments) {
    if (c.entity_type !== "issue") continue;
    const id = typeof c.entity_id === "string" ? c.entity_id : "";
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const writes: CommentCountPlan[] = [];
  let unchanged = 0;
  for (const { id, data } of issues) {
    const after = counts.get(id) ?? 0;
    counts.delete(id);
    const before = data[ISSUE_COMMENT_COUNT_FIELD];
    // A missing field already reads as 0, so an issue with no comments and
    // no field needs no write.
    if (before === after || (before === undefined && after === 0)) unchanged++;
    else writes.push({ issueId: id, before, after });
  }
  let orphans = 0;
  for (const n of counts.values()) orphans += n;
  return { writes, unchanged, orphans };
}
