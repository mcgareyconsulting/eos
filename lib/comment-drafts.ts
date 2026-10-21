// Which items have a comment typed but not posted, in this tab. The
// ActivityFeed composer keeps it current; a control that would take the
// item off screen (ticking a milestone or to-do moves or hides its row,
// unmounting the composer and its text) checks it first and asks.

const drafts = new Set<string>();

export function commentDraftKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function setCommentDraft(key: string, hasDraft: boolean): void {
  if (hasDraft) drafts.add(key);
  else drafts.delete(key);
}

export function hasCommentDraft(key: string): boolean {
  return drafts.has(key);
}
