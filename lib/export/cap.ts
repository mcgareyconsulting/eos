// The export row cap (docs/EXPORT.md, guardrail 8), and the helpers a page
// definition uses to honor it EARLY — before reading or sub-reading rows the
// file could never contain.
//
// The cap refuses; it never truncates. A partial file handed to an auditor
// is worse than none, so the answer to an oversize view is always "narrow
// the filters", never the first 5,000 rows.
//
// Two helpers, for the two shapes a loader has:
//
//   readCapped(query)   the query IS the view (nothing filters it further in
//                       memory): read at most cap + 1 docs, and refuse when
//                       the extra one arrives.
//   checkRowCap(n)      the view is the query's docs filtered in memory (the
//                       To-Dos page): limiting the query would refuse views
//                       that fit, so check the filtered count — and do it
//                       BEFORE any per-row sub-read (milestones per rock,
//                       comments per item), so an oversize view costs one
//                       query, not N + 1.
//
// The core re-checks the count after `load` (lib/export/run.ts), so a loader
// that forgets is still refused — just later than it needed to be.
//
// Leaf module: page definitions import it without pulling in the core (which
// imports the registry, which imports the pages).

import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { ExportRefusal } from "./types";

/** Largest view an export will produce. */
export const EXPORT_ROW_CAP = 5_000;

/** What a capped query asks for: one past the cap, to tell "fits" from "doesn't". */
export const EXPORT_QUERY_LIMIT = EXPORT_ROW_CAP + 1;

/** `rows` null: a capped query stopped at the limit, so the true count is unknown. */
export function overCapMessage(rows: number | null, cap = EXPORT_ROW_CAP): string {
  const size =
    rows === null
      ? `more than ${cap.toLocaleString("en-US")}`
      : rows.toLocaleString("en-US");
  return (
    `This view has ${size} rows; exports are limited to ` +
    `${cap.toLocaleString("en-US")}. Narrow the filters (owner, team, active or ` +
    `archived, period) and export again.`
  );
}

export function overCapRefusal(rows: number | null): ExportRefusal {
  return { ok: false, status: 413, message: overCapMessage(rows), reason: "over_cap" };
}

/** A refusal when `rows` filtered rows exceed the cap, else null. */
export function checkRowCap(rows: number): ExportRefusal | null {
  return rows > EXPORT_ROW_CAP ? overCapRefusal(rows) : null;
}

/**
 * Read a query that is exactly the view, at most cap + 1 docs. Over the cap
 * → the refusal, before anything is done with the docs.
 */
export async function readCapped<T>(
  query: Query<T>,
): Promise<{ ok: true; docs: QueryDocumentSnapshot<T>[] } | ExportRefusal> {
  const snap = await query.limit(EXPORT_QUERY_LIMIT).get();
  if (snap.docs.length > EXPORT_ROW_CAP) return overCapRefusal(null);
  return { ok: true, docs: snap.docs };
}
