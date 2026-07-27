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

/**
 * Client shell for the standalone scorecard page: owns filter state and
 * applies status / owner / sort / search before handing rows to the grid.
 */
export function ScorecardPanel({
  teamId,
  teamLabel,
  weekRange,
  weeks,
  metrics,
  entryByMetricWeek,
  members,
  showDelete = true,
  showGroupEditor = true,
}: {
  teamId: string;
  teamLabel: string;
  weekRange: WeekRange;
  weeks: string[];
  metrics: ScorecardMetric[];
  entryByMetricWeek: Record<string, number | null>;
  members: ScorecardMember[];
  showDelete?: boolean;
  showGroupEditor?: boolean;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ownerId, setOwnerId] = useState("");
  const [sort, setSort] = useState<SortOption>("status");
  const [search, setSearch] = useState("");

  const entryMap = useMemo(
    () => new Map(Object.entries(entryByMetricWeek)),
    [entryByMetricWeek],
  );

  const valuesFor = (metricId: string) =>
    weeks.map((w) => entryMap.get(`${metricId}__${w}`) ?? null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = metrics.filter((m) => {
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
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "owner") {
        return (
          ownerName(a.owner_id).localeCompare(ownerName(b.owner_id)) ||
          a.name.localeCompare(b.name)
        );
      }
      if (sort === "average-asc" || sort === "average-desc") {
        const av = average(valuesFor(a.id));
        const bv = average(valuesFor(b.id));
        // Null averages sort last.
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av - bv;
        return sort === "average-asc" ? cmp : -cmp;
      }
      // Default: status (off-track first), then name.
      const as = trendStatus(valuesFor(a.id), a.goal, a.direction);
      const bs = trendStatus(valuesFor(b.id), b.goal, b.direction);
      return (
        statusSortRank(as) - statusSortRank(bs) || a.name.localeCompare(b.name)
      );
    });

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, members, entryMap, weeks, status, ownerId, sort, search]);

  return (
    <div className="space-y-4">
      <ScorecardFilters
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
        totalCount={metrics.length}
      />

      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">Weekly</h2>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-200 px-2 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {filtered.length}
          {filtered.length !== metrics.length ? `/${metrics.length}` : ""}
        </span>
      </div>

      <ScorecardGrid
        teamId={teamId}
        weeks={weeks}
        metrics={filtered}
        entryByMetricWeek={entryMap}
        members={members}
        showDelete={showDelete}
        showGroupEditor={showGroupEditor}
        // Filtering lives in the panel; grid is presentation-only.
        hideLocalSearch
        // Preserve the panel's sort order. Grouped sections re-sort by
        // section name and would bury off-track rows under other groups.
        flatList={
          sort !== "name" ||
          status !== "all" ||
          ownerId !== "" ||
          !!search.trim()
        }
        emptyHint={
          metrics.length === 0
            ? undefined
            : "No measurables match these filters."
        }
      />
    </div>
  );
}
