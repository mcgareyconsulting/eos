"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query as fsQuery,
  where,
} from "firebase/firestore";
import type { ActivityRowLike } from "@/lib/activity-feed";
import { getClientDb } from "./client";
import { useAuthUid } from "./use-collection";

/**
 * Live `entity_activity` rows for a set of to-dos (a to-do's own trace, or a
 * rock's milestones — a milestone is a to-do). Rows come back tagged with
 * their `entity_id`, unsorted.
 *
 * One equality listener per to-do — `entity_type == "todo"` and
 * `entity_id == <id>`, exactly the query EntityActivity already runs — and
 * deliberately not an `in` query: the read rule (`todoSeeById`) costs three
 * lookups per to-do, so an `in` over a rock's milestones would run past the
 * rules lookup budget (see lib/firestore-in.ts) after three ids. Equality on
 * two fields needs no composite index.
 *
 * Only to-dos carry a trace (lib/activity.ts `ActivityEntityType`), and the
 * rule only serves to-do rows, so there is no rock/issue/headline variant.
 */
export function useTodoActivity(todoIds: readonly string[]): ActivityRowLike[] {
  const db = getClientDb();
  const uid = useAuthUid();

  // Stable key so a parent re-render with the same ids doesn't resubscribe.
  const idsKey = useMemo(
    () => [...new Set(todoIds.filter(Boolean))].sort().join(","),
    [todoIds],
  );
  const [byId, setById] = useState<Record<string, ActivityRowLike[]>>({});

  useEffect(() => {
    // Wait for client auth — a listener attached before request.auth exists
    // is permanently denied (see useCollection).
    if (!uid || !idsKey) return;
    const ids = idsKey.split(",");
    const unsubs = ids.map((id) =>
      onSnapshot(
        fsQuery(
          collection(db, "entity_activity"),
          where("entity_type", "==", "todo"),
          where("entity_id", "==", id),
        ),
        (snap) => {
          const rows = snap.docs.map(
            (d) =>
              ({ id: d.id, ...(d.data() as object) }) as ActivityRowLike,
          );
          setById((prev) => ({ ...prev, [id]: rows }));
        },
        (err) => {
          console.error(`[useTodoActivity] subscription error (${id}):`, err);
        },
      ),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [db, uid, idsKey]);

  return useMemo(() => {
    if (!idsKey) return [];
    return idsKey.split(",").flatMap((id) =>
      (byId[id] ?? []).map((r) => ({ ...r, entity_id: r.entity_id ?? id })),
    );
  }, [byId, idsKey]);
}
