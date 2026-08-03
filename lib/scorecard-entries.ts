import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { chunkForInQuery } from "@/lib/firestore-in";

export type ScorecardEntryRow = {
  id: string;
  metric_id: string;
  week_start_date: string;
  value: number | null;
  note?: string | null;
};

/**
 * Load scorecard_entries for any number of metrics, chunking the Firestore
 * `in` filter so metrics beyond the 30th still get their week values.
 * Admin SDK only (server components / server actions).
 */
export async function loadScorecardEntries(
  db: Firestore,
  metricIds: string[],
  oldestWeek: string,
): Promise<ScorecardEntryRow[]> {
  if (metricIds.length === 0) return [];

  const snaps = await Promise.all(
    chunkForInQuery(metricIds).map((ids) =>
      db
        .collection("scorecard_entries")
        .where("metric_id", "in", ids)
        .where("week_start_date", ">=", oldestWeek)
        .get(),
    ),
  );

  const rows: ScorecardEntryRow[] = [];
  for (const snap of snaps) {
    for (const d of snap.docs as QueryDocumentSnapshot[]) {
      const x = d.data();
      rows.push({
        id: d.id,
        metric_id: x.metric_id as string,
        week_start_date: x.week_start_date as string,
        value: (x.value as number | null) ?? null,
        note: (x.note as string | null) ?? null,
      });
    }
  }
  return rows;
}

/** Build the metricId__week → value map the scorecard grid expects. */
export function entriesToRecord(
  entries: { metric_id: string; week_start_date: string; value: number | null }[],
): Record<string, number | null> {
  const rec: Record<string, number | null> = {};
  for (const e of entries) {
    rec[`${e.metric_id}__${e.week_start_date}`] = e.value;
  }
  return rec;
}
