// Pure set helpers behind milestone expansion (milestone-expansion.tsx):
// which milestones are open, and which hold an unsent comment. Sets are
// treated as immutable so React state updates stay cheap to compare — an
// update that changes nothing hands back the same set, and React skips the
// re-render.

const EMPTY: ReadonlySet<string> = new Set();

export function emptyKeys(): ReadonlySet<string> {
  return EMPTY;
}

/** `key` flipped in or out of `set`. Always a new set. */
export function toggleKey(
  set: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * `key` marked as holding a draft (`has`) or not. Returns `set` itself when
 * nothing changes, so reporting the same state twice is free.
 */
export function withDraft(
  set: ReadonlySet<string>,
  key: string,
  has: boolean,
): ReadonlySet<string> {
  if (set.has(key) === has) return set;
  const next = new Set(set);
  if (has) next.add(key);
  else next.delete(key);
  return next;
}
