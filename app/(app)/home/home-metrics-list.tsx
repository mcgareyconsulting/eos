"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATUS_TONE,
  average,
  formatGoal,
  formatValue,
  hitRate,
  onTrack,
  type GoalDirection,
  type TrendStatus,
} from "@/lib/scorecard";
import { type ScorecardColumn } from "@/lib/scorecard-periods";
import { MetricExpand } from "@/components/scorecard/metric-expand";

export type HomeMetricListItem = {
  id: string;
  name: string;
  teamName: string;
  unit: string;
  goal: number | null;
  direction: GoalDirection;
  intervalLabel: string;
  /** Newest first — same order MetricExpand / trendStatus expect. */
  columns: ScorecardColumn[];
  values: (number | null)[];
  status: TrendStatus;
};

/**
 * Personal scorecard metrics on Home: single-row summary (scorecard-style)
 * with expand for the trend panel. No navigation to the team scorecard.
 */
export function HomeMetricsList({ metrics }: { metrics: HomeMetricListItem[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (metrics.length === 0) {
    return (
      <p className="px-3.5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No scorecard metrics assigned to you.
      </p>
    );
  }

  return (
    <ul>
      {metrics.map((m) => {
        const expanded = open.has(m.id);
        const tone = STATUS_TONE[m.status];
        const avg = average(m.values);
        const avgOk = onTrack(avg, m.goal, m.direction);
        const {
          hit,
          recorded,
          pct,
          applicable: hitApplies,
        } = hitRate(m.values, m.goal, m.direction);
        const avgTone =
          avgOk == null
            ? "text-zinc-600 dark:text-zinc-400"
            : avgOk
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300";

        return (
          <li
            key={m.id}
            className={cn(
              "border-b border-zinc-100 last:border-b-0 dark:border-zinc-800",
              expanded && "bg-hpb-blue/[0.03]",
            )}
          >
            <div
              className={cn(
                "flex items-stretch",
                "border-l-[3px]",
                tone.railBorder,
              )}
            >
              <div className="flex w-9 shrink-0 items-center justify-center">
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? `Hide trend for ${m.name}`
                      : `Show trend for ${m.name}`
                  }
                  title="Show trend"
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={() => toggle(m.id)}
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2.5 text-left hover:bg-zinc-50/80 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5.5rem] md:grid-cols-[minmax(0,1fr)_7rem_5.5rem_5rem_5.5rem] dark:hover:bg-zinc-800/40"
              >
                <div className="min-w-0">
                  <div
                    className="truncate text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100"
                    title={m.name}
                  >
                    {m.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-px text-[9.5px] font-bold ring-1 ring-inset",
                        tone.pill,
                      )}
                    >
                      {tone.label}
                    </span>
                    {hitApplies && recorded > 0 && (
                      <>
                        <span className="relative block h-1 w-11 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <span
                            className={cn("absolute inset-y-0 left-0", tone.rail)}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="text-[10.5px] tabular-nums text-zinc-500">
                          {hit}/{recorded} hit
                        </span>
                      </>
                    )}
                    <span className="text-[11px] text-zinc-400 sm:hidden">
                      {m.teamName}
                    </span>
                  </div>
                </div>

                <div className="hidden min-w-0 truncate text-[12px] font-semibold text-zinc-500 sm:block dark:text-zinc-400">
                  {m.teamName}
                </div>

                <div className="hidden text-[11.5px] font-medium text-zinc-500 md:block">
                  {m.intervalLabel}
                </div>

                <div className="hidden text-right text-[12.5px] tabular-nums text-zinc-600 sm:block dark:text-zinc-400">
                  {formatGoal(m.goal, m.direction, m.unit)}
                </div>

                <div
                  className={cn(
                    "text-right text-[12.5px] font-medium tabular-nums",
                    avgTone,
                  )}
                  title={
                    avg == null
                      ? "No entries yet"
                      : `Average of ${m.values.filter((v) => v != null).length} recorded periods`
                  }
                >
                  {formatValue(avg, m.unit)}
                </div>
              </button>
            </div>

            {expanded && (
              <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
                <MetricExpand
                  metric={{
                    id: m.id,
                    name: m.name,
                    goal: m.goal,
                    direction: m.direction,
                    unit: m.unit,
                  }}
                  ownerName="You"
                  columns={m.columns}
                  values={m.values}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
