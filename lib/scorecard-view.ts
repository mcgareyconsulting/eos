// The Scorecard toolbar's rules (components/scorecard/scorecard-panel.tsx):
// which measurables a filter keeps, the order a sort puts them in, and when
// the grid drops its groups for a flat list. Pure, and shared with the admin
// export (lib/export/pages/scorecard.ts) so the grid and the file can't drift.

import { compareBySpeakingOrder } from "@/lib/l10/speaking-order";
import {
  average,
  statusSortRank,
  trendStatus,
  type GoalDirection,
  type SortOption,
  type StatusFilter,
} from "@/lib/scorecard";
import { normalizeMetricInterval, type ScorecardPeriod } from "@/lib/scorecard-periods";

/** What the toolbar rules read from a row. */
export type ScorecardViewMetric = {
  id: string;
  name: string;
  owner_id: string | null;
  goal: number | null;
  direction: GoalDirection;
  sort_order: number;
  group?: string | null;
  sectionName?: string | null;
  interval?: string | null;
};

export type ScorecardToolbar = {
  status: StatusFilter;
  /** "" = every owner. */
  ownerId: string;
  /** "" = every group; else a resolved section name. */
  group: string;
  sort: SortOption;
  search: string;
};

/** The panel's opening state: no filters, Default order. */
export const DEFAULT_SCORECARD_TOOLBAR: ScorecardToolbar = {
  status: "all",
  ownerId: "",
  group: "",
  sort: "order",
  search: "",
};

/** Tab = interval of the metric, not a rollup of another interval. */
export function metricsForPeriod<M extends { interval?: string | null }>(
  metrics: readonly M[],
  period: ScorecardPeriod,
): M[] {
  return metrics.filter((m) => normalizeMetricInterval(m.interval) === period);
}

/**
 * The interval's rows the toolbar keeps, in the order it sorts them. See the
 * panel for why each rule is what it is (viewer's rows first, never in the
 * L10; Default order = sort_order standalone, speaking order in the L10).
 */
export function filterAndSortScorecard<M extends ScorecardViewMetric>(
  intervalMetrics: readonly M[],
  toolbar: ScorecardToolbar,
  ctx: {
    valuesFor: (metricId: string) => (number | null)[];
    members: readonly { user_id: string; full_name: string }[];
    speakingOrder?: string[];
    absentUserIds?: string[];
    viewerId?: string;
  },
): M[] {
  const { status, ownerId, group, sort, search } = toolbar;
  const { valuesFor, members, speakingOrder, absentUserIds, viewerId } = ctx;
  const q = search.trim().toLowerCase();
  let rows = intervalMetrics.filter((m) => {
    if (ownerId && m.owner_id !== ownerId) return false;
    // Filters on the *resolved* section, not the stored `group`, so picking
    // "Weekly" finds the rows that render under Weekly.
    if (group && (m.sectionName ?? m.group ?? "") !== group) return false;

    const values = valuesFor(m.id);
    const st = trendStatus(values, m.goal, m.direction);
    if (status !== "all" && st !== status) return false;

    if (q) {
      const owner = members.find((x) => x.user_id === m.owner_id)?.full_name ?? "";
      const g = m.group ?? "";
      if (
        !m.name.toLowerCase().includes(q) &&
        !owner.toLowerCase().includes(q) &&
        !g.toLowerCase().includes(q)
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
      const mine = (m: { owner_id: string | null }) => (m.owner_id === viewerId ? 0 : 1);
      const byMine = mine(a) - mine(b);
      if (byMine !== 0) return byMine;
    }

    if (sort === "order") {
      // L10: participant/speaking order (not status reshuffle). Standalone
      // keeps configured sort_order only.
      if (speakingOrder && speakingOrder.length > 0) {
        return compareBySpeakingOrder(a, b, speakingOrder, absentUserIds ?? []);
      }
      return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
    }
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "owner") {
      // Prefer speaking order when available (same as L10 default).
      if (speakingOrder && speakingOrder.length > 0) {
        return compareBySpeakingOrder(a, b, speakingOrder, absentUserIds ?? []);
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
    return statusSortRank(as) - statusSortRank(bs) || a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Whether the grid renders a flat list instead of groups. An explicit sort
 * flattens (regrouping rows someone deliberately re-sorted would bury what
 * they asked for); an owner filter does not; status and search do.
 */
export function scorecardFlatList(toolbar: Pick<ScorecardToolbar, "sort" | "status" | "search">): boolean {
  return (
    (toolbar.sort !== "name" && toolbar.sort !== "order") ||
    toolbar.status !== "all" ||
    !!toolbar.search.trim()
  );
}
