"use client";

import { Trash2 } from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { GroupCell } from "@/app/(app)/teams/[teamId]/scorecard/group-cell";
import { EditMetricModal } from "@/app/(app)/teams/[teamId]/scorecard/edit-metric-modal";
import { deleteMetric } from "@/app/(app)/teams/[teamId]/scorecard/actions";
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
import {
  type MetricInterval,
  type ScorecardColumn,
} from "@/lib/scorecard-periods";
import { TrendChart } from "./trend-chart";

/**
 * The drop-down panel under an expanded grid row: five facts, the Trends
 * chart, and — on the Scorecard tab — the row's manage controls. Rendered
 * inside a full-width <td colSpan>, so it spans the frozen columns and the
 * period columns.
 *
 * The manage bar is here rather than in the row itself (N48). Delete used to
 * live in a trailing table column and was hidden three ways at once: past all
 * 13 period columns so it sat off the right edge until you scrolled the grid
 * fully across, then `opacity-0` until its row was hovered, then `text-zinc-300`
 * once revealed. Steph reported the capability as missing; it had shipped and
 * worked all along. The expand chevron is in the frozen first column and never
 * scrolls away, so anything reachable from this panel is reachable, full stop.
 *
 * The group editor moves in with it. `GroupCell` was orphaned by the 2026-08-31
 * grid rework — the component survived, its column did not — leaving the only
 * way to regroup a measurable the Add form. Both controls belong to the same
 * question ("change this row"), so they share the same home.
 */
export function MetricExpand({
  metric,
  ownerName,
  columns,
  values,
  panelWidth,
  manage,
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
  /**
   * Row-level manage controls (group + delete). Omitted in the L10, which
   * passes `showManage={false}` — a meeting reads the scorecard, it does not
   * restructure it.
   */
  manage?: {
    teamId: string;
    group: string | null;
    /** Full metric row — the edit form needs owner/interval, not just the facts above. */
    metric: {
      id: string;
      name: string;
      unit: string;
      goal: number | null;
      direction: string;
      owner_id: string | null;
      group?: string | null;
      interval?: string | null;
    };
    members: { user_id: string; full_name: string }[];
    /** Period owned by this metric's group, when it sits in a defined one. */
    groupInterval?: MetricInterval | null;
  };
}) {
  const status = trendStatus(values, metric.goal, metric.direction);
  const tone = STATUS_TONE[status];
  const avg = average(values);
  const avgOk = onTrack(avg, metric.goal, metric.direction);
  const {
    hit,
    recorded,
    applicable: hitApplies,
  } = hitRate(values, metric.goal, metric.direction);
  // The in-progress period is excluded — see missingCount().
  const missing = missingCount(
    values,
    columns.map((c) => c.isCurrent),
  );

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
            {hitApplies ? (
              <span className="tabular-nums">
                {recorded ? `${hit} of ${recorded}` : "—"}
              </span>
            ) : (
              <span className="text-zinc-500 dark:text-zinc-400">
                Set a goal
              </span>
            )}
          </Fact>
          <Fact label="Missing" last>
            <span
              className={cn(
                "tabular-nums",
                missing > 2 ? "text-hpb-brown dark:text-hpb-gold" : "",
              )}
            >
              {missing === 0
                ? "none"
                : `${missing} ${missing === 1 ? "period" : "periods"}`}
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

        {manage && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-zinc-400">
              Group
            </span>
            <GroupCell
              teamId={manage.teamId}
              metricId={metric.id}
              initial={manage.group}
            />
            <div className="ml-auto flex items-center gap-2">
              <EditMetricModal
                teamId={manage.teamId}
                metric={manage.metric}
                members={manage.members}
                groupInterval={manage.groupInterval}
              />
            <ConfirmSubmitForm
              action={deleteMetric.bind(null, manage.teamId, metric.id)}
              confirmMessage={`Delete "${metric.name}"? This removes the measurable from the scorecard, including its logged history. This can't be undone.`}
            >
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete measurable
              </button>
            </ConfirmSubmitForm>
            </div>
          </div>
        )}
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
