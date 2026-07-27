"use client";

import { useMemo } from "react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { ValueCell } from "../../scorecard/value-cell";
import { formatGoal } from "@/lib/scorecard";
import { formatWeekLabel } from "@/lib/dates";
import { QuickAddIssue } from "@/components/quick-add-issue";

type MetricDoc = {
  id: string;
  team_id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: "gte" | "lte" | "eq";
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

function onTrack(
  value: number | null,
  goal: number | null,
  direction: MetricDoc["direction"],
): boolean | null {
  if (value == null || goal == null) return null;
  if (direction === "gte") return value >= goal;
  if (direction === "lte") return value <= goal;
  return value === goal;
}

export function SegmentScorecard({
  teamId,
  weeks,
  initialMetrics,
  initialEntries,
  members,
}: {
  teamId: string;
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
  const oldestWeek = weeks[weeks.length - 1];

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

  const byKey = new Map<string, number | null>();
  for (const e of entries) {
    byKey.set(`${e.metric_id}__${e.week_start_date}`, e.value);
  }

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  const sorted = [...metrics].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  const totalCols = 3 + weeks.length;

  // Same section bucketing as the standalone scorecard page — ungrouped
  // metrics render first with no header.
  const groupedMetrics = new Map<string, typeof sorted>();
  for (const m of sorted) {
    const key = m.group?.trim() || "";
    const bucket = groupedMetrics.get(key);
    if (bucket) bucket.push(m);
    else groupedMetrics.set(key, [m]);
  }
  const ungrouped = groupedMetrics.get("") ?? [];
  const groupNames = [...groupedMetrics.keys()]
    .filter((g) => g !== "")
    .sort((a, b) => a.localeCompare(b));

  const renderMetricRow = (m: (typeof sorted)[number]) => (
    <tr
      key={m.id}
      className="border-b border-zinc-200 dark:border-zinc-800 last:border-0"
    >
      <td className="px-4 py-2 font-medium">{m.name}</td>
      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
        {ownerName(m.owner_id)}
      </td>
      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 tabular-nums">
        {formatGoal(m.goal, m.direction, m.unit)}
      </td>
      {weeks.map((w) => {
        const v = byKey.get(`${m.id}__${w}`) ?? null;
        return (
          <td key={w} className="px-1 py-1">
            <ValueCell
              teamId={teamId}
              metricId={m.id}
              weekStartDate={w}
              initial={v}
              onTrack={onTrack(v, m.goal, m.direction)}
            />
          </td>
        );
      })}
    </tr>
  );

  const renderGroupHeader = (g: string) => (
    <tr key={`group-${g}`} className="bg-zinc-50 dark:bg-zinc-950/40">
      <td
        colSpan={totalCols}
        className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        {g}
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          last {weeks.length} weeks · off-track? drop to Issues
        </div>
        <QuickAddIssue
          teamId={teamId}
          prefill="Off-track metric: "
          compact
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Metric</th>
              <th className="text-left px-4 py-2 font-medium">Owner</th>
              <th className="text-left px-4 py-2 font-medium">Goal</th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className="text-right px-2 py-2 font-medium tabular-nums"
                >
                  {formatWeekLabel(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={totalCols}
                  className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-400"
                >
                  No metrics yet.
                </td>
              </tr>
            )}
            {ungrouped.map(renderMetricRow)}
            {groupNames.flatMap((g) => [
              renderGroupHeader(g),
              ...groupedMetrics.get(g)!.map(renderMetricRow),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
