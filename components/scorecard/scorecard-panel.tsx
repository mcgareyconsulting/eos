"use client";

import { useMemo, useState } from "react";
import { ScorecardFilters } from "./scorecard-filters";
import {
  ScorecardGrid,
  type ScorecardMember,
  type ScorecardMetric,
} from "./scorecard-grid";
import {
  average,
  statusSortRank,
  trendStatus,
  type SortOption,
  type StatusFilter,
  type WeekRange,
} from "@/lib/scorecard";
import {
  PERIOD_LABELS,
  normalizeMetricInterval,
  type ScorecardColumn,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { compareBySpeakingOrder } from "@/lib/l10/speaking-order";

/**
 * Client shell for the standalone scorecard: filter state + metric filter by
 * interval tab. Each tab shows only measurables created at that interval.
 */
export function ScorecardPanel({
  teamId,
  teamLabel,
  period = "weekly",
  weekRange,
  columns,
  metrics,
  entryByMetricWeek,
  members,
  showDelete = true,
  showGroupEditor = true,
  compact = false,
  /** L10: when set, Default order walks owner speaking order (P1-4). */
  speakingOrder,
  /** L10: absentees sort after present owners (same as Rocks). */
  absentUserIds,
  toolbarExtra,
}: {
  teamId: string;
  teamLabel?: string;
  /** Active interval tab; filters metrics + drives column grain. */
  period?: ScorecardPeriod;
  weekRange: WeekRange;
  columns: ScorecardColumn[];
  metrics: ScorecardMetric[];
  entryByMetricWeek: Record<string, number | null>;
  members: ScorecardMember[];
  showDelete?: boolean;
  showGroupEditor?: boolean;
  /** L10 segment: weekly-only, no period tabs. */
  compact?: boolean;
  speakingOrder?: string[];
  absentUserIds?: string[];
  toolbarExtra?: React.ReactNode;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ownerId, setOwnerId] = useState("");
  const [sort, setSort] = useState<SortOption>(compact ? "order" : "status");
  const [search, setSearch] = useState("");

  const entryMap = useMemo(
    () => new Map(Object.entries(entryByMetricWeek)),
    [entryByMetricWeek],
  );

  // Tab = interval of the metric, not a rollup of another interval.
  const intervalMetrics = useMemo(
    () =>
      metrics.filter(
        (m) => normalizeMetricInterval(m.interval) === period,
      ),
    [metrics, period],
  );

  const valuesFor = (metricId: string) =>
    columns.map((c) => entryMap.get(`${metricId}__${c.id}`) ?? null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = intervalMetrics.filter((m) => {
      if (ownerId && m.owner_id !== ownerId) return false;

      const values = valuesFor(m.id);
      const st = trendStatus(values, m.goal, m.direction);
      if (status !== "all" && st !== status) return false;

      if (q) {
        const owner =
          members.find((x) => x.user_id === m.owner_id)?.full_name ?? "";
        const group = m.group ?? "";
        if (
          !m.name.toLowerCase().includes(q) &&
          !owner.toLowerCase().includes(q) &&
          !group.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

    const ownerName = (id: string | null) =>
      id ? (members.find((x) => x.user_id === id)?.full_name ?? "") : "";

    rows = [...rows].sort((a, b) => {
      if (sort === "order") {
        // L10: participant/speaking order (not status reshuffle). Standalone
        // keeps configured sort_order only.
        if (speakingOrder && speakingOrder.length > 0) {
          return compareBySpeakingOrder(
            a,
            b,
            speakingOrder,
            absentUserIds ?? [],
          );
        }
        return (
          a.sort_order - b.sort_order || a.name.localeCompare(b.name)
        );
      }
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "owner") {
        // Prefer speaking order when available (same as L10 default).
        if (speakingOrder && speakingOrder.length > 0) {
          return compareBySpeakingOrder(
            a,
            b,
            speakingOrder,
            absentUserIds ?? [],
          );
        }
        return (
          ownerName(a.owner_id).localeCompare(ownerName(b.owner_id)) ||
          a.name.localeCompare(b.name)
        );
      }
      if (sort === "average-asc" || sort === "average-desc") {
        const av = average(valuesFor(a.id));
        const bv = average(valuesFor(b.id));
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av - bv;
        return sort === "average-asc" ? cmp : -cmp;
      }
      const as = trendStatus(valuesFor(a.id), a.goal, a.direction);
      const bs = trendStatus(valuesFor(b.id), b.goal, b.direction);
      return (
        statusSortRank(as) - statusSortRank(bs) || a.name.localeCompare(b.name)
      );
    });

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    intervalMetrics,
    members,
    entryMap,
    columns,
    status,
    ownerId,
    sort,
    search,
    speakingOrder,
    absentUserIds,
  ]);

  return (
    <div className="space-y-4">
      <ScorecardFilters
        period={period}
        weekRange={weekRange}
        teamLabel={teamLabel}
        members={members}
        status={status}
        onStatusChange={setStatus}
        ownerId={ownerId}
        onOwnerChange={setOwnerId}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={setSearch}
        visibleCount={filtered.length}
        totalCount={intervalMetrics.length}
        compact={compact}
        extra={toolbarExtra}
      />

      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            {PERIOD_LABELS[period]} measurables
          </h2>
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-200 px-2 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {filtered.length}
            {filtered.length !== intervalMetrics.length
              ? `/${intervalMetrics.length}`
              : ""}
          </span>
        </div>
      )}

      <ScorecardGrid
        teamId={teamId}
        columns={columns}
        metrics={filtered}
        entryByMetricWeek={entryMap}
        members={members}
        showDelete={showDelete}
        showGroupEditor={showGroupEditor}
        compact={compact}
        hideLocalSearch
        // L10 speaking order must not be reshuffled by section groups.
        flatList={
          Boolean(speakingOrder?.length) ||
          (sort !== "name" && sort !== "order") ||
          status !== "all" ||
          ownerId !== "" ||
          !!search.trim()
        }
        emptyHint={
          intervalMetrics.length === 0
            ? `No ${PERIOD_LABELS[period].toLowerCase()} measurables yet — add one below (interval: ${PERIOD_LABELS[period]}).`
            : "No measurables match these filters."
        }
      />
    </div>
  );
}
