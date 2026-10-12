// Firestore `in` / `not-in` / `array-contains-any` accept at most 30 values.
// Chunking is required anywhere we query by a dynamic id list (scorecard
// entries by metric_id, home-page todos by team_id when a user is on many
// teams, etc.). Without it, callers silently drop ids past the 30th and
// rows render as empty dashes — the scorecard "visibility" bug from the
// 2026-07-29 L10.

export const FIRESTORE_IN_LIMIT = 30;

/**
 * Chunk size for a CLIENT `in` query whose read rule get()s one document per
 * value (scorecard_entries → its metric). The rules evaluate an `in` query
 * once per value and every get() counts against the request's lookup budget
 * (10 per query in the Firestore docs), plus one for `users/{uid}`
 * (`myTeamIds()`): 9 values + 1 = 10. A bigger chunk is refused outright.
 * Admin SDK queries bypass rules and keep FIRESTORE_IN_LIMIT.
 */
export const RULES_GET_IN_LIMIT = 9;

export function chunkForInQuery<T>(
  ids: readonly T[],
  size: number = FIRESTORE_IN_LIMIT,
): T[][] {
  if (ids.length === 0) return [];
  const step = Math.max(1, Math.min(size, FIRESTORE_IN_LIMIT));
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += step) {
    chunks.push(ids.slice(i, i + step) as T[]);
  }
  return chunks;
}
