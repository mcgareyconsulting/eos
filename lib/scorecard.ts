export type GoalDirection = "gte" | "lte" | "eq";

export function formatGoal(
  goal: number | null,
  direction: string,
  unit: string,
): string {
  if (goal == null) return "—";
  // Match the familiar ninety-style comparators the client already knows.
  const arrow = direction === "gte" ? ">=" : direction === "lte" ? "<=" : "=";
  return `${arrow} ${formatValue(goal, unit)}`;
}

// Same unit rendering as formatGoal but without the comparator prefix.
// Used for averages, individual cell displays, etc.
export function formatValue(value: number | null, unit: string): string {
  if (value == null) return "—";
  if (unit === "currency") {
    return `$${value.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  }
  if (unit === "percent") {
    return `${value.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}%`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function onTrack(
  value: number | null,
  goal: number | null,
  direction: GoalDirection,
): boolean | null {
  if (value == null || goal == null) return null;
  if (direction === "gte") return value >= goal;
  if (direction === "lte") return value <= goal;
  return value === goal;
}

// Average of recorded weeks only — empty weeks don't drag the average down.
export function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Coarse status for the left "trend" column.
 * Labels map to the client's existing system:
 * - off   → Off-track
 * - watch → At-risk
 * - ok    → On-track
 * - empty → no recent scores
 *
 * Status uses the N most recently *populated* scores (default 3),
 * matching ninety's Trends rule — empty weeks don't count.
 */
export type TrendStatus = "ok" | "watch" | "off" | "empty";

export const TREND_STATUS_LABEL: Record<TrendStatus, string> = {
  off: "Off-track",
  watch: "At-risk",
  ok: "On-track",
  empty: "No data",
};

export function trendStatus(
  valuesNewestFirst: (number | null)[],
  goal: number | null,
  direction: GoalDirection,
  populatedLookback = 3,
): TrendStatus {
  const recorded: number[] = [];
  for (const v of valuesNewestFirst) {
    if (v != null) {
      recorded.push(v);
      if (recorded.length >= populatedLookback) break;
    }
  }
  if (recorded.length === 0) return "empty";
  if (goal == null) return "ok";

  let off = 0;
  for (const v of recorded) {
    if (onTrack(v, goal, direction) === false) off += 1;
  }
  if (off === 0) return "ok";
  // Strict majority off-track (ties count as at-risk).
  if (off > recorded.length / 2) return "off";
  return "watch";
}

/** Allowed rolling windows for the weekly grid. */
export const WEEK_RANGE_OPTIONS = [8, 13, 26] as const;
export type WeekRange = (typeof WEEK_RANGE_OPTIONS)[number];

export function parseWeekRange(raw: string | undefined | null): WeekRange {
  const n = Number(raw);
  if (n === 8 || n === 13 || n === 26) return n;
  return 13;
}

/** Client-side status filter (Trends-style). */
export type StatusFilter = "all" | TrendStatus;

export const STATUS_FILTER_OPTIONS: {
  value: StatusFilter;
  label: string;
}[] = [
  { value: "all", label: "All statuses" },
  { value: "off", label: "Off-track" },
  { value: "watch", label: "At-risk" },
  { value: "ok", label: "On-track" },
  { value: "empty", label: "No data" },
];

export type SortOption =
  | "order"
  | "status"
  | "name"
  | "owner"
  | "average-asc"
  | "average-desc";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  // Preserves the team's configured sort_order (and L10 presentation order).
  // Default in-meeting so metrics aren't reshuffled to "off-track first".
  { value: "order", label: "Default order" },
  { value: "status", label: "Status (off-track first)" },
  { value: "name", label: "Name A–Z" },
  { value: "owner", label: "Owner A–Z" },
  { value: "average-desc", label: "Average high → low" },
  { value: "average-asc", label: "Average low → high" },
];

const STATUS_SORT_RANK: Record<TrendStatus, number> = {
  off: 0,
  watch: 1,
  empty: 2,
  ok: 3,
};

export function statusSortRank(status: TrendStatus): number {
  return STATUS_SORT_RANK[status];
}
