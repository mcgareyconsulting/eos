"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Search,
  Trash2,
} from "lucide-react";
import { ValueCell } from "@/app/(app)/teams/[teamId]/scorecard/value-cell";
import { GroupCell } from "@/app/(app)/teams/[teamId]/scorecard/group-cell";
import { deleteMetric } from "@/app/(app)/teams/[teamId]/scorecard/actions";
import {
  average,
  formatGoal,
  formatValue,
  onTrack,
  trendStatus,
  type GoalDirection,
  type TrendStatus,
} from "@/lib/scorecard";
import {
  formatWeekRange,
  mondayOf,
  toDateString,
  weekYear,
} from "@/lib/dates";
import { cn } from "@/lib/utils";
import { MiniSparkline } from "./mini-sparkline";

export type ScorecardMetric = {
  id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  group?: string | null;
};

export type ScorecardMember = {
  user_id: string;
  full_name: string;
};

// Fixed left-column widths so sticky offsets stay aligned while weeks scroll.
const COL = {
  trend: 40,
  title: 240,
  goal: 88,
  avg: 72,
} as const;

const LEFT = {
  trend: 0,
  title: COL.trend,
  goal: COL.trend + COL.title,
  avg: COL.trend + COL.title + COL.goal,
} as const;

const FROZEN_WIDTH = COL.trend + COL.title + COL.goal + COL.avg;

function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function TrendIcon({ status }: { status: TrendStatus }) {
  if (status === "ok") {
    return (
      <CheckCircle2
        className="h-4 w-4 text-emerald-500 dark:text-emerald-400"
        aria-label="On track"
      />
    );
  }
  if (status === "off") {
    return (
      <AlertTriangle
        className="h-4 w-4 text-amber-500 dark:text-amber-400"
        aria-label="Off track"
      />
    );
  }
  if (status === "watch") {
    return (
      <AlertTriangle
        className="h-4 w-4 text-amber-400/80 dark:text-amber-500/80"
        aria-label="Mixed results"
      />
    );
  }
  return (
    <CircleHelp
      className="h-4 w-4 text-zinc-300 dark:text-zinc-600"
      aria-label="No data"
    />
  );
}

/** Sticky cell shell; pixel `left` is applied via style for exact offsets. */
function stickyCell(extra?: string) {
  return cn("sticky bg-white dark:bg-zinc-900", extra);
}

export function ScorecardGrid({
  teamId,
  weeks,
  metrics,
  entryByMetricWeek,
  members,
  showDelete = false,
  showGroupEditor = true,
  compact = false,
  initialSearch = "",
}: {
  teamId: string;
  /** Newest first (YYYY-MM-DD Mondays). */
  weeks: string[];
  metrics: ScorecardMetric[];
  entryByMetricWeek: Map<string, number | null> | Record<string, number | null>;
  members: ScorecardMember[];
  showDelete?: boolean;
  showGroupEditor?: boolean;
  compact?: boolean;
  initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  const currentWeek = toDateString(mondayOf());

  const entryMap = useMemo(() => {
    if (entryByMetricWeek instanceof Map) return entryByMetricWeek;
    return new Map(Object.entries(entryByMetricWeek));
  }, [entryByMetricWeek]);

  const ownerName = (id: string | null) =>
    id ? (members.find((m) => m.user_id === id)?.full_name ?? "—") : "—";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return metrics;
    return metrics.filter((m) => {
      const owner = ownerName(m.owner_id).toLowerCase();
      const group = (m.group ?? "").toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        owner.includes(q) ||
        group.includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, search, members]);

  const groupedMetrics = useMemo(() => {
    const map = new Map<string, ScorecardMetric[]>();
    for (const m of filtered) {
      const key = m.group?.trim() || "";
      const bucket = map.get(key);
      if (bucket) bucket.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [filtered]);

  const ungrouped = groupedMetrics.get("") ?? [];
  const groupNames = [...groupedMetrics.keys()]
    .filter((g) => g !== "")
    .sort((a, b) => a.localeCompare(b));

  // Year spans for the week header row (e.g. a single "2026" bar).
  const yearSpans = useMemo(() => {
    const spans: { year: number; count: number }[] = [];
    for (const w of weeks) {
      const y = weekYear(w);
      const last = spans[spans.length - 1];
      if (last && last.year === y) last.count += 1;
      else spans.push({ year: y, count: 1 });
    }
    return spans;
  }, [weeks]);

  const stickyShadow =
    "shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_6px_-2px_rgba(0,0,0,0.35)]";

  const headerBg = "bg-zinc-50 dark:bg-zinc-950";
  const totalCols =
    4 + weeks.length + (showDelete ? 1 : 0);

  const renderMetricRow = (m: ScorecardMetric) => {
    const values = weeks.map(
      (w) => entryMap.get(`${m.id}__${w}`) ?? null,
    );
    const avg = average(values);
    const avgOnTrack = onTrack(avg, m.goal, m.direction);
    const status = trendStatus(values, m.goal, m.direction);
    const owner = ownerName(m.owner_id);

    const avgTone =
      avgOnTrack == null
        ? "text-zinc-600 dark:text-zinc-400"
        : avgOnTrack
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-red-700 dark:text-red-300";

    return (
      <tr
        key={m.id}
        className="group border-b border-zinc-200 dark:border-zinc-800 last:border-0"
      >
        <td
          className={cn(stickyCell(), "z-10 px-2 py-2 text-center")}
          style={{ left: LEFT.trend, width: COL.trend, minWidth: COL.trend }}
        >
          <div className="flex justify-center">
            <TrendIcon status={status} />
          </div>
        </td>

        <td
          className={cn(stickyCell(), "z-10 px-3 py-2")}
          style={{ left: LEFT.title, width: COL.title, minWidth: COL.title }}
        >
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold"
              title={owner}
            >
              {ownerInitials(owner === "—" ? m.name : owner)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {m.name}
                </span>
                <MiniSparkline
                  valuesNewestFirst={values}
                  status={status}
                  className="hidden sm:inline-block shrink-0 opacity-80"
                />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {owner}
                </span>
                {showGroupEditor && (
                  <GroupCell
                    teamId={teamId}
                    metricId={m.id}
                    initial={m.group ?? null}
                  />
                )}
              </div>
            </div>
          </div>
        </td>

        <td
          className={cn(
            stickyCell(),
            "z-10 px-2 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400",
          )}
          style={{ left: LEFT.goal, width: COL.goal, minWidth: COL.goal }}
        >
          {formatGoal(m.goal, m.direction, m.unit)}
        </td>

        <td
          className={cn(
            stickyCell(),
            stickyShadow,
            "z-10 px-2 py-2 text-right font-medium tabular-nums",
            avgTone,
          )}
          style={{ left: LEFT.avg, width: COL.avg, minWidth: COL.avg }}
          title={
            avg == null
              ? "No entries yet"
              : `Average of ${values.filter((v) => v != null).length} recorded weeks`
          }
        >
          {formatValue(avg, m.unit)}
        </td>

        {weeks.map((w, i) => {
          const v = values[i] ?? null;
          const isCurrent = w === currentWeek;
          return (
            <td
              key={w}
              className={cn(
                "px-1 py-1",
                isCurrent && "bg-sky-50/40 dark:bg-sky-950/15",
              )}
            >
              <ValueCell
                teamId={teamId}
                metricId={m.id}
                weekStartDate={w}
                initial={v}
                onTrack={onTrack(v, m.goal, m.direction)}
                isCurrentWeek={isCurrent}
              />
            </td>
          );
        })}

        {showDelete && (
          <td className="px-2 py-2 text-right">
            <form action={deleteMetric.bind(null, teamId, m.id)}>
              <button
                type="submit"
                className="text-zinc-300 opacity-0 group-hover:opacity-100 dark:text-zinc-600 hover:text-red-600"
                aria-label="Delete metric"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </form>
          </td>
        )}
      </tr>
    );
  };

  const renderGroupHeader = (g: string, count: number) => (
    <tr key={`group-${g}`} className="bg-zinc-50/80 dark:bg-zinc-950/50">
      <td
        colSpan={totalCols}
        className="py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        {/* Keep section label visible while weeks scroll horizontally. */}
        <div className="sticky left-0 w-max px-4">
          {g}
          <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200/80 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {count}
          </span>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      {/* Familiar filter strip — search + live count. Team lives in the shell. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search measurables…"
            className="w-full rounded-full border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Search measurables"
          />
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {filtered.length} measurable{filtered.length === 1 ? "" : "s"}
          {search.trim() ? ` matching “${search.trim()}”` : ""}
        </span>
      </div>

      <div
        className={cn(
          "overflow-x-auto rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900",
          compact ? "max-h-[min(60vh,28rem)] overflow-y-auto" : "max-h-[min(75vh,40rem)] overflow-y-auto",
        )}
      >
        <table
          className="w-max min-w-full border-separate border-spacing-0 text-sm"
          style={{ minWidth: FROZEN_WIDTH + weeks.length * 88 }}
        >
          <thead className="sticky top-0 z-30">
            {/* Year band across week columns only */}
            <tr className={headerBg}>
              <th
                colSpan={4}
                className={cn(
                  "sticky left-0 z-40 border-b border-zinc-200 dark:border-zinc-800",
                  headerBg,
                )}
                style={{ left: 0, width: FROZEN_WIDTH, minWidth: FROZEN_WIDTH }}
              />
              {yearSpans.map((span) => (
                <th
                  key={`year-${span.year}-${span.count}`}
                  colSpan={span.count}
                  className={cn(
                    "border-b border-zinc-200 px-2 py-1 text-center text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400",
                    headerBg,
                  )}
                >
                  {span.year}
                </th>
              ))}
              {showDelete && (
                <th
                  className={cn(
                    "border-b border-zinc-200 dark:border-zinc-800 w-8",
                    headerBg,
                  )}
                />
              )}
            </tr>
            <tr className={cn(headerBg, "text-xs text-zinc-600 dark:text-zinc-400")}>
              <th
                className={cn(
                  stickyCell(headerBg),
                  "z-40 border-b border-zinc-200 px-1 py-2 font-medium dark:border-zinc-800",
                )}
                style={{ left: LEFT.trend, width: COL.trend, minWidth: COL.trend }}
                title="Recent trend vs goal"
              >
                <span className="sr-only">Trend</span>
              </th>
              <th
                className={cn(
                  stickyCell(headerBg),
                  "z-40 border-b border-zinc-200 px-3 py-2 text-left font-medium dark:border-zinc-800",
                )}
                style={{ left: LEFT.title, width: COL.title, minWidth: COL.title }}
              >
                Title
              </th>
              <th
                className={cn(
                  stickyCell(headerBg),
                  "z-40 border-b border-zinc-200 px-2 py-2 text-right font-medium dark:border-zinc-800",
                )}
                style={{ left: LEFT.goal, width: COL.goal, minWidth: COL.goal }}
              >
                Goal
              </th>
              <th
                className={cn(
                  stickyCell(headerBg),
                  stickyShadow,
                  "z-40 border-b border-zinc-200 px-2 py-2 text-right font-medium dark:border-zinc-800",
                )}
                style={{ left: LEFT.avg, width: COL.avg, minWidth: COL.avg }}
              >
                Average
              </th>
              {weeks.map((w) => {
                const isCurrent = w === currentWeek;
                return (
                  <th
                    key={w}
                    className={cn(
                      "border-b border-zinc-200 px-2 py-2 text-center font-medium tabular-nums dark:border-zinc-800",
                      headerBg,
                      isCurrent && "text-hpb-blue dark:text-hpb-gold",
                    )}
                  >
                    {isCurrent && (
                      <span className="mb-0.5 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-hpb-blue dark:bg-hpb-gold" />
                        Current week
                      </span>
                    )}
                    <span className="block whitespace-nowrap">
                      {formatWeekRange(w)}
                    </span>
                  </th>
                );
              })}
              {showDelete && (
                <th
                  className={cn(
                    "border-b border-zinc-200 w-8 dark:border-zinc-800",
                    headerBg,
                  )}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={totalCols}
                  className="px-4 py-10 text-center text-zinc-500 dark:text-zinc-400"
                >
                  {metrics.length === 0
                    ? "No metrics yet."
                    : "No measurables match your search."}
                </td>
              </tr>
            )}
            {ungrouped.map(renderMetricRow)}
            {groupNames.flatMap((g) => {
              const rows = groupedMetrics.get(g) ?? [];
              return [
                renderGroupHeader(g, rows.length),
                ...rows.map(renderMetricRow),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
