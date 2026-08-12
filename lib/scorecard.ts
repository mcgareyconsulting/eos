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
 * - nogoal → scores exist but there's no goal to measure them against
 *
 * Status uses the N most recently *populated* scores (default 3),
 * matching ninety's Trends rule — empty weeks don't count.
 */
export type TrendStatus = "ok" | "watch" | "off" | "empty" | "nogoal";

export const TREND_STATUS_LABEL: Record<TrendStatus, string> = {
  off: "Off-track",
  watch: "At-risk",
  ok: "On-track",
  empty: "No data",
  nogoal: "No goal",
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
  if (goal == null) return "nogoal";

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
  { value: "nogoal", label: "No goal" },
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
  // Standalone: configured sort_order. L10 (with speakingOrder): owner
  // speaking sequence so the walk matches Segue/Rocks (P1-4).
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
  nogoal: 3,
  ok: 4,
};

export function statusSortRank(status: TrendStatus): number {
  return STATUS_SORT_RANK[status];
}

/**
 * One tone per TrendStatus, shared by the row rail, the status pill and the
 * Trends chart accent. Unified with the Rocks palette (hpb-green / hpb-gold /
 * red-600) so both screens read as one system.
 *
 * `accent` is a raw hex because the SVG chart needs a stroke/fill value, not a
 * Tailwind class. `railBorder` is literal (not derived at runtime) so Tailwind
 * v4's scanner picks it up.
 */
export const STATUS_TONE: Record<
  TrendStatus,
  {
    label: string;
    accent: string;
    railBorder: string;
    rail: string;
    pill: string;
    text: string;
    icon: string;
  }
> = {
  ok: {
    label: TREND_STATUS_LABEL.ok,
    accent: "#2cb34a",
    railBorder: "border-l-hpb-green",
    rail: "bg-hpb-green",
    pill: "bg-hpb-green/10 text-hpb-green ring-hpb-green/30",
    text: "text-hpb-green",
    icon: "text-hpb-green",
  },
  watch: {
    label: TREND_STATUS_LABEL.watch,
    accent: "#ffc845",
    railBorder: "border-l-hpb-gold",
    rail: "bg-hpb-gold",
    pill: "bg-hpb-gold/15 text-hpb-brown ring-hpb-gold/40 dark:text-hpb-gold",
    text: "text-hpb-brown dark:text-hpb-gold",
    icon: "text-hpb-gold",
  },
  off: {
    label: TREND_STATUS_LABEL.off,
    accent: "#dc2626",
    railBorder: "border-l-red-600",
    rail: "bg-red-600",
    pill: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900",
    text: "text-red-600 dark:text-red-400",
    icon: "text-red-600",
  },
  nogoal: {
    label: TREND_STATUS_LABEL.nogoal,
    accent: "#a1a1aa",
    railBorder: "border-l-zinc-400 dark:border-l-zinc-600",
    rail: "bg-zinc-400 dark:bg-zinc-600",
    pill: "bg-zinc-100 text-zinc-600 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600",
    text: "text-zinc-600 dark:text-zinc-300",
    icon: "text-zinc-400 dark:text-zinc-500",
  },
  empty: {
    label: TREND_STATUS_LABEL.empty,
    accent: "#d4d4d8",
    railBorder: "border-l-zinc-300 dark:border-l-zinc-700",
    rail: "bg-zinc-300 dark:bg-zinc-700",
    pill: "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
    text: "text-zinc-500 dark:text-zinc-400",
    icon: "text-zinc-300 dark:text-zinc-600",
  },
};

/**
 * Periods that met the goal, out of the periods that have a value.
 *
 * `applicable` is false when the metric has no goal — every period then
 * "misses" vacuously, so callers must render that as "—", not "0 of N hit".
 */
export function hitRate(
  values: (number | null)[],
  goal: number | null,
  direction: GoalDirection,
): { hit: number; recorded: number; pct: number; applicable: boolean } {
  const recorded = values.filter((v) => v != null).length;
  const hit = values.filter((v) => onTrack(v, goal, direction) === true).length;
  return {
    hit,
    recorded,
    pct: recorded ? Math.round((hit / recorded) * 100) : 0,
    applicable: goal != null,
  };
}

/** Periods in the window with no entry at all — the sparse-data signal. */
export function missingCount(values: (number | null)[]): number {
  return values.filter((v) => v == null).length;
}
