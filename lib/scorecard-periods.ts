/**
 * Scorecard metric intervals — Weekly / Monthly / Quarterly / Annual.
 *
 * Model (ninety-style): each measurable is created *at* an interval. An
 * annual metric is not a weekly metric viewed annually. The period tabs
 * filter metrics by `metric.interval` and show columns at that grain for
 * direct entry (not rollups of finer periods).
 *
 * Entry storage reuses `scorecard_entries.week_start_date` as the period
 * key (YYYY-MM-DD of the period start) so existing queries keep working:
 *   weekly    → Monday of the week
 *   monthly   → 1st of the month
 *   quarterly → 1st of the quarter (Jan/Apr/Jul/Oct)
 *   annual    → Jan 1 of the year
 */

import {
  lastNMondays,
  mondayOf,
  toDateString,
  formatWeekRange,
} from "@/lib/dates";

export const SCORECARD_PERIODS = [
  "weekly",
  "monthly",
  "quarterly",
  "annual",
] as const;

export type ScorecardPeriod = (typeof SCORECARD_PERIODS)[number];

/** Alias used on metric docs — same union as the tab filter. */
export type MetricInterval = ScorecardPeriod;

export const PERIOD_LABELS: Record<ScorecardPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** How many period columns to show (newest first). */
const COLUMN_COUNTS: Record<ScorecardPeriod, number> = {
  weekly: 13, // overridden by weekRange when building weekly columns
  monthly: 12,
  quarterly: 8,
  annual: 5,
};

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function parseScorecardPeriod(
  raw: string | undefined | null,
): ScorecardPeriod {
  if (
    raw === "monthly" ||
    raw === "quarterly" ||
    raw === "annual" ||
    raw === "weekly"
  ) {
    return raw;
  }
  return "weekly";
}

/** Missing/legacy metrics are weekly. */
export function normalizeMetricInterval(
  raw: string | null | undefined,
): MetricInterval {
  return parseScorecardPeriod(raw);
}

export type ScorecardColumn = {
  /** Period start YYYY-MM-DD (also the entry key suffix). */
  id: string;
  label: string;
  isCurrent: boolean;
  /**
   * Kept for call-site compatibility: always a single period start.
   * (Older rollup code used multiple weekStarts per column.)
   */
  weekStarts: string[];
  /** All interval columns are editable at their own grain. */
  editable: boolean;
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3); // 0..3
  return new Date(d.getFullYear(), q * 3, 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

/** Period-start date string for a calendar point at the given interval. */
export function periodStartFor(
  interval: MetricInterval,
  from: Date = new Date(),
): string {
  if (interval === "weekly") return toDateString(mondayOf(from));
  if (interval === "monthly") return toDateString(startOfMonth(from));
  if (interval === "quarterly") return toDateString(startOfQuarter(from));
  return toDateString(startOfYear(from));
}

function labelForPeriodStart(interval: MetricInterval, start: string): string {
  const d = new Date(start + "T00:00:00");
  if (interval === "weekly") return formatWeekRange(start);
  if (interval === "monthly") {
    return `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (interval === "quarterly") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `Q${q} ${d.getFullYear()}`;
  }
  return String(d.getFullYear());
}

/**
 * Build editable columns for an interval tab.
 * `weekRange` only applies to weekly (8 / 13 / 26).
 */
export function buildScorecardColumns(
  interval: MetricInterval,
  _weekStartsNewestFirst: string[] | undefined,
  weekRange: number,
  from: Date = new Date(),
): ScorecardColumn[] {
  if (interval === "weekly") {
    const n =
      weekRange === 8 || weekRange === 13 || weekRange === 26
        ? weekRange
        : COLUMN_COUNTS.weekly;
    const weeks = lastNMondays(n, from).map(toDateString);
    const current = toDateString(mondayOf(from));
    return weeks.map((w) => ({
      id: w,
      label: formatWeekRange(w),
      isCurrent: w === current,
      weekStarts: [w],
      editable: true,
    }));
  }

  const count = COLUMN_COUNTS[interval];
  const currentId = periodStartFor(interval, from);
  const cols: ScorecardColumn[] = [];

  for (let i = 0; i < count; i++) {
    let start: Date;
    if (interval === "monthly") {
      start = new Date(from.getFullYear(), from.getMonth() - i, 1);
    } else if (interval === "quarterly") {
      const base = startOfQuarter(from);
      start = new Date(base.getFullYear(), base.getMonth() - i * 3, 1);
    } else {
      start = new Date(from.getFullYear() - i, 0, 1);
    }
    const id = toDateString(start);
    cols.push({
      id,
      label: labelForPeriodStart(interval, id),
      isCurrent: id === currentId,
      weekStarts: [id],
      editable: true,
    });
  }
  return cols;
}

/**
 * Oldest period-start string to load for entries (`week_start_date >=`).
 * Generated from the same columns as the grid so load window matches UI.
 */
export function oldestPeriodStart(
  interval: MetricInterval,
  weekRange: number,
  from: Date = new Date(),
): string {
  const cols = buildScorecardColumns(interval, undefined, weekRange, from);
  return cols[cols.length - 1]?.id ?? periodStartFor(interval, from);
}

/** @deprecated use oldestPeriodStart — kept name for page call sites. */
export function weekStartsToLoad(
  interval: MetricInterval,
  weekRange: number,
  from: Date = new Date(),
): string[] {
  return buildScorecardColumns(interval, undefined, weekRange, from).map(
    (c) => c.id,
  );
}

/** Weeks of history to request — for weekly only; non-weekly uses period starts. */
export function weeksToLoadForPeriod(
  period: ScorecardPeriod,
  weekRange: number,
): number {
  if (period === "weekly") return weekRange;
  // Non-weekly: caller should use oldestPeriodStart / weekStartsToLoad.
  return weekRange;
}
