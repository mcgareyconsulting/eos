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
 * - ok: recent recorded weeks all on-track (or no goal yet)
 * - watch: mixed recent results
 * - off: majority of recent recorded weeks off-track
 * - empty: nothing entered yet
 */
export type TrendStatus = "ok" | "watch" | "off" | "empty";

export function trendStatus(
  valuesNewestFirst: (number | null)[],
  goal: number | null,
  direction: GoalDirection,
  lookback = 4,
): TrendStatus {
  const recent = valuesNewestFirst.slice(0, lookback);
  const recorded = recent.filter((v): v is number => v != null);
  if (recorded.length === 0) return "empty";
  if (goal == null) return "ok";

  let off = 0;
  for (const v of recorded) {
    if (onTrack(v, goal, direction) === false) off += 1;
  }
  if (off === 0) return "ok";
  // Strict majority off-track (ties count as "watch").
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
