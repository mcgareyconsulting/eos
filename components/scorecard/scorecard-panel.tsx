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
import type { ScorecardGroup } from "@/lib/scorecard-groups";

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
  showManage = true,
  groups = [],
  compact = false,
  /** L10: when set, Default order walks owner speaking order. */
  speakingOrder,
  /** L10: absentees sort after present owners (same as Rocks). */
  absentUserIds,
  toolbarExtra,
  viewerId,
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
  showManage?: boolean;
  /** Team's scorecard groups; ordering + period for the group headers. */
  groups?: ScorecardGroup[];
  /** L10 segment: weekly-only, no period tabs. */
  compact?: boolean;
  speakingOrder?: string[];
  absentUserIds?: string[];
  toolbarExtra?: React.ReactNode;
  /**
   * The signed-in user, so their own measurables sort first **within each
   * group** on the standalone scorecard.
   *
   * Deliberately a sort and not a filter or a separate "My measurables"
   * table: lifting the viewer's rows out would break them away from the group
   * they belong to and render a section that exists for nobody but the
   * viewer. Grouping is the scorecard's structure; whose row it is, is an
   * ordering question inside it.
   *
   * Ignored in the L10, where speaking order decides the sequence and a
   * viewer-first shuffle would put whoever is looking at the screen ahead of
   * whoever is meant to be talking.
   */
  viewerId?: string;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ownerId, setOwnerId] = useState("");
  // Filters on the *resolved* section, not the stored `group`, so picking
  // "Weekly" finds the rows that render under Weekly rather than only the ones
  // someone happened to type that word into.
  const [group, setGroup] = useState("");
  // "order" on both surfaces, because it is the only sort that keeps groups.
  // Any other sort flattens the grid (see `flatList` below), so defaulting the
  // Scorecard tab to "status" meant grouping was never visible there without
  // changing a dropdown first — the feature shipped invisible (client, 8/31).
  // Off-track-first is still one selection away.
  const [sort, setSort] = useState<SortOption>("order");
  const [search, setSearch] = useState("");

  const entryMap = useMemo(
    () => new Map(Object.entries(entryByMetricWeek)),
    [entryByMetricWeek],
  );

  // Tab = interval of the metric, not a rollup of another interval.
  const intervalMetrics = useMemo(
    () => metrics.filter((m) => normalizeMetricInterval(m.interval) === period),
    [metrics, period],
  );

  const valuesFor = (metricId: string) =>
    columns.map((c) => entryMap.get(`${metricId}__${c.id}`) ?? null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = intervalMetrics.filter((m) => {
      if (ownerId && m.owner_id !== ownerId) return false;
      if (group && (m.sectionName ?? m.group ?? "") !== group) return false;

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

    const inL10 = !!speakingOrder && speakingOrder.length > 0;

    rows = [...rows].sort((a, b) => {
      // **Your rows lead, whatever the sort.** Applied before the sort choice
      // rather than inside Default order, because the ask is "top of my
      // subsection" and the subsection is whatever grouping is in effect —
      // a real group under Default/Name, and the flat list under Status,
      // Average or Owner, which collapse the groups anyway. Bucketing
      // preserves this order, so one comparison here puts you first inside
      // *every* group you own a measurable in without lifting you out of any.
      //
      // Never in the L10: there the sequence is whose turn it is to speak,
      // and putting whoever happens to be driving the screen at the top would
      // reorder the room.
      if (viewerId && !inL10) {
        const mine = (m: { owner_id: string | null }) =>
          m.owner_id === viewerId ? 0 : 1;
        const byMine = mine(a) - mine(b);
        if (byMine !== 0) return byMine;
      }

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
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
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
    viewerId,
    group,
  ]);

  // Built from the interval's rows, not from `filtered` — deriving them after
  // the group filter applied would leave the select holding only the option
  // already chosen, with no way back to the others.
  const groupOptions = useMemo(() => {
    const seen: string[] = [];
    for (const m of intervalMetrics) {
      const name = (m.sectionName ?? m.group ?? "").trim();
      if (name && !seen.includes(name)) seen.push(name);
    }
    return seen.sort((a, b) => a.localeCompare(b));
  }, [intervalMetrics]);

  const statusCounts = filtered.reduce(
    (acc, m) => {
      acc[trendStatus(valuesFor(m.id), m.goal, m.direction)] += 1;
      return acc;
    },
    { ok: 0, watch: 0, off: 0, empty: 0, nogoal: 0 },
  );

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
        group={group}
        onGroupChange={setGroup}
        groupOptions={groupOptions}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={setSearch}
        // "order" is the default on both surfaces and means different things:
        // the team's configured sort_order standalone, owner speaking order in
        // the L10. Name it after what it actually does here.
        orderLabel={
          speakingOrder && speakingOrder.length > 0
            ? "Speaking order"
            : "Default order"
        }
        extra={toolbarExtra}
      />

      {!compact && (
        <div>
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-red-600 dark:text-red-400">
              {statusCounts.off} off-track
            </span>{" "}
            ·{" "}
            <span className="font-semibold text-hpb-brown dark:text-hpb-gold">
              {statusCounts.watch} at-risk
            </span>
          </p>
        </div>
      )}

      <ScorecardGrid
        teamId={teamId}
        columns={columns}
        metrics={filtered}
        entryByMetricWeek={entryMap}
        members={members}
        showManage={showManage}
        groups={groups}
        interval={period}
        compact={compact}
        hideLocalSearch
        /*
         * Grouping and speaking order compose rather than compete.
         * Rows arrive already sorted — by speaking order in the L10 — and the
         * grid buckets them in that order, so each group renders its own
         * speaking round: Weekly in speaker order, then Compliance in speaker
         * order. This matches the tool teams came from; the L10 used to force
         * a flat list here on the assumption the two orderings conflicted,
         * which made the grouping look absent.
         *
         * An explicit sort still flattens — regrouping rows someone deliberately
         * re-sorted would bury what they asked for. Filtering by owner does not:
         * it subsets the rows without touching their order, so the groups still
         * hold while reading one person's measurables. Status and search still
         * flatten on the old rule.
         */
        flatList={
          (sort !== "name" && sort !== "order") ||
          status !== "all" ||
          !!search.trim()
        }
        emptyHint={
          intervalMetrics.length === 0
            ? compact
              ? `No ${PERIOD_LABELS[period].toLowerCase()} measurables yet — add them on the Scorecard tab.`
              : `No ${PERIOD_LABELS[period].toLowerCase()} measurables yet — use Add measurable (interval defaults to ${PERIOD_LABELS[period]}).`
            : "No measurables match these filters."
        }
      />
    </div>
  );
}
