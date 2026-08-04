"use client";

import { cn } from "@/lib/utils";
import {
  STATUS_TONE,
  average,
  formatGoal,
  formatValue,
  hitRate,
  missingCount,
  onTrack,
  trendStatus,
  type GoalDirection,
} from "@/lib/scorecard";
import { type ScorecardColumn } from "@/lib/scorecard-periods";
import { TrendChart } from "./trend-chart";

/**
 * The drop-down panel under an expanded grid row: five facts, then the Trends
 * chart. Rendered inside a full-width <td colSpan>, so it spans the frozen
 * columns and the period columns.
 */
export function MetricExpand({
  metric,
  ownerName,
  columns,
  values,
  panelWidth,
}: {
  metric: {
    id: string;
    name: string;
    goal: number | null;
    direction: GoalDirection;
    unit: string;
  };
  ownerName: string;
  /** Newest first, same array the row uses. */
  columns: ScorecardColumn[];
  values: (number | null)[];
  /** Pinned panel width from the grid; the chart fills it. */
  panelWidth?: number;
}) {
  const status = trendStatus(values, metric.goal, metric.direction);
  const tone = STATUS_TONE[status];
  const avg = average(values);
  const avgOk = onTrack(avg, metric.goal, metric.direction);
  const { hit, recorded } = hitRate(values, metric.goal, metric.direction);
  const missing = missingCount(values);

  // "Aug 3" style labels for the chart's x axis — the grid's own column labels
  // are full ranges ("Aug 3 – 9") and would collide at 13 columns.
  const labels = columns.map((c) => c.label.split(/\s*[–-]\s*/)[0] ?? c.label);

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-zinc-300 bg-zinc-50 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/30">
      <div className={cn("w-[3px] shrink-0", tone.rail)} aria-hidden />
      <div className="min-w-0 flex-1">
        <dl className="flex border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <Fact label="Owner">{ownerName}</Fact>
          <Fact label="Goal">
            <span className="tabular-nums">
              {formatGoal(metric.goal, metric.direction, metric.unit)}
            </span>
          </Fact>
          <Fact label={`${columns.length}-period average`}>
            <span
              className={cn(
                "tabular-nums",
                avgOk == null ? "" : avgOk ? tone.text : "text-red-600 dark:text-red-400",
              )}
            >
              {formatValue(avg, metric.unit)}
            </span>
          </Fact>
          <Fact label="Periods hit">
            <span className="tabular-nums">
              {recorded ? `${hit} of ${recorded}` : "—"}
            </span>
          </Fact>
          <Fact label="Missing" last>
            <span
              className={cn(
                "tabular-nums",
                missing > 2 ? "text-hpb-brown dark:text-hpb-gold" : "",
              )}
            >
              {missing === 0 ? "none" : `${missing} periods`}
            </span>
          </Fact>
        </dl>

        <div className="px-4 pb-3 pt-3.5">
          <TrendChart
            values={values}
            labels={labels}
            goal={metric.goal}
            average={avg}
            unit={metric.unit}
            accent={tone.accent}
            // 37 = card border (2) + 3px rail + 16px chart padding either side.
            width={panelWidth ? panelWidth - 37 : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[120px] flex-1 px-3.5 py-2.5",
        !last && "border-r border-zinc-100 dark:border-zinc-800",
      )}
    >
      <dt className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-zinc-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}
