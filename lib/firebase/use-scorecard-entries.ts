"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query as fsQuery,
  where,
  type QuerySnapshot,
} from "firebase/firestore";
import { chunkForInQuery } from "@/lib/firestore-in";
import { getClientDb } from "./client";
import { useAuthUid } from "./use-collection";

type EntryDoc = {
  id: string;
  metric_id: string;
  week_start_date: string;
  value: number | null;
};

/**
 * Live scorecard_entries for an arbitrary metric list. Chunks the Firestore
 * `in` filter (max 30) so teams with 31+ measurables still stream values.
 * Falls back to `initial` until client auth is ready (or if the user has
 * no client session — see LiveAuthBanner).
 */
export function useScorecardEntries(
  metricIds: string[],
  oldestWeek: string,
  initial: EntryDoc[],
): EntryDoc[] {
  const db = getClientDb();
  const uid = useAuthUid();
  const [entries, setEntries] = useState<EntryDoc[]>(initial);

  // Stable key so we don't re-subscribe when the parent reorders the same ids.
  const idsKey = useMemo(
    () => [...metricIds].sort().join(","),
    [metricIds],
  );
  const sortedIds = useMemo(
    () => (idsKey ? idsKey.split(",") : []),
    [idsKey],
  );

  // Keep SSR hydration in sync when the parent re-fetches (e.g. week range).
  useEffect(() => {
    setEntries(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed when the id set / window changes
  }, [idsKey, oldestWeek]);

  useEffect(() => {
    if (!uid || sortedIds.length === 0 || !oldestWeek) return;

    const chunks = chunkForInQuery(sortedIds);
    // Per-chunk latest docs; merged into one list on every snapshot.
    const byChunk = new Map<number, EntryDoc[]>();

    const unsubs = chunks.map((chunk, index) => {
      const q = fsQuery(
        collection(db, "scorecard_entries"),
        where("metric_id", "in", chunk),
        where("week_start_date", ">=", oldestWeek),
      );
      return onSnapshot(
        q,
        (snap: QuerySnapshot) => {
          byChunk.set(
            index,
            snap.docs.map((d) => {
              const x = d.data();
              return {
                id: d.id,
                metric_id: x.metric_id as string,
                week_start_date: x.week_start_date as string,
                value: (x.value as number | null) ?? null,
              };
            }),
          );
          const merged: EntryDoc[] = [];
          for (let i = 0; i < chunks.length; i++) {
            const part = byChunk.get(i);
            if (part) merged.push(...part);
          }
          setEntries(merged);
        },
        (err) => {
          console.error("[useScorecardEntries] subscription error:", err);
        },
      );
    });

    return () => {
      for (const u of unsubs) u();
    };
  }, [db, uid, idsKey, oldestWeek, sortedIds]);

  return entries;
}
