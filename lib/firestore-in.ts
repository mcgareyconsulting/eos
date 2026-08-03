// Firestore `in` / `not-in` / `array-contains-any` accept at most 30 values.
// Chunking is required anywhere we query by a dynamic id list (scorecard
// entries by metric_id, home-page todos by team_id when a user is on many
// teams, etc.). Without it, callers silently drop ids past the 30th and
// rows render as empty dashes — the scorecard "visibility" bug from the
// 2026-07-29 L10.

export const FIRESTORE_IN_LIMIT = 30;

export function chunkForInQuery<T>(ids: readonly T[]): T[][] {
  if (ids.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += FIRESTORE_IN_LIMIT) {
    chunks.push(ids.slice(i, i + FIRESTORE_IN_LIMIT) as T[]);
  }
  return chunks;
}
