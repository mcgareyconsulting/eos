"use client";

import { useMemo } from "react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import { QuickAddIssue } from "@/components/quick-add-issue";
import type { GoalDirection, WeekRange } from "@/lib/scorecard";

type MetricDoc = {
  id: string;
  team_id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  // Optional section label — see scorecard/page.tsx. Missing on metrics
  // created before grouping existed, and on the SSR-serialized
  // `initialMetrics` until the realtime listener below replaces it.
  group?: string | null;
};

type EntryDoc = {
  id: string;
  metric_id: string;
  week_start_date: string;
  value: number | null;
};

type Member = { user_id: string; full_name: string };

export function SegmentScorecard({
  teamId,
  weekRange,
  weeks,
  initialMetrics,
  initialEntries,
  members,
}: {
  teamId: string;
  weekRange: WeekRange;
  weeks: string[]; // newest first, YYYY-MM-DD Mondays
  initialMetrics: MetricDoc[];
  initialEntries: EntryDoc[];
  members: Member[];
}) {
  const db = getClientDb();

  const metricsQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "scorecard_metrics"),
        where("team_id", "==", teamId),
      ),
    [db, teamId],
  );
  const metrics = useCollection<MetricDoc>(metricsQuery, initialMetrics);

  const metricIds = metrics.map((m) => m.id).sort();
  const metricIdsKey = metricIds.join(",");
  const oldestWeek = weeks[weeks.length - 1] ?? "";

  const entriesQuery = useMemo(() => {
    if (metricIds.length === 0) return null;
    return fsQuery(
      collection(db, "scorecard_entries"),
      // Firestore `in` is capped at 30 — same constraint as the page route.
      where("metric_id", "in", metricIds.slice(0, 30)),
      where("week_start_date", ">=", oldestWeek),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, metricIdsKey, oldestWeek]);

  const entries = useCollection<EntryDoc>(entriesQuery, initialEntries);

  const entryRecord = useMemo(() => {
    const rec: Record<string, number | null> = {};
    for (const e of entries) {
      rec[`${e.metric_id}__${e.week_start_date}`] = e.value;
    }
    return rec;
  }, [entries]);

  const sorted = useMemo(
    () =>
      [...metrics].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      ),
    [metrics],
  );

  // Same filter shell as the standalone Scorecard page (range / status /
  // owner / sort / search), minus the period tabs — data stays live via the
  // subscriptions above.
  return (
    <ScorecardPanel
      teamId={teamId}
      weekRange={weekRange}
      weeks={weeks}
      metrics={sorted}
      entryByMetricWeek={entryRecord}
      members={members}
      showDelete={false}
      showGroupEditor={false}
      compact
      toolbarExtra={
        <QuickAddIssue teamId={teamId} prefill="Off-track metric: " compact />
      }
    />
  );
}
