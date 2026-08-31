"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, Search, Trash2 } from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { ValueCell } from "@/app/(app)/teams/[teamId]/scorecard/value-cell";
import {
  orderGroupNames,
  type ScorecardGroup,
} from "@/lib/scorecard-groups";
import { deleteMetric } from "@/app/(app)/teams/[teamId]/scorecard/actions";
import {
  average,
  formatGoal,
  formatValue,
  formatValueExact,
  bucketMetricsByGroup,
  hitRate,
  onTrack,
  STATUS_TONE,
  trendStatus,
  type GoalDirection,
} from "@/lib/scorecard";
import { type ScorecardColumn } from "@/lib/scorecard-periods";
import { cn } from "@/lib/utils";
import { MetricExpand } from "./metric-expand";
import { ownerLabel } from "@/lib/user-name";

export type ScorecardMetric = {
  id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  group?: string | null;
  /** weekly | monthly | quarterly | annual — missing = weekly */
  interval?: string | null;
};

export type ScorecardMember = {
  user_id: string;
  full_name: string;
};

// Fixed left-column widths so sticky offsets stay aligned while weeks scroll.
//
// There is no owner column (client, 8/31): the owner reads as a line under the
// measurable name instead, since an initials avatar bought a 44px column to say
// what a name says better. Reinstate it only for profile photos, where the face
// is the point.
//
// `title` is sized to its content — the widest measurable name is ~165px and the
// status pill row needs ~160px intrinsically. It sat at 250 while the avatar
// column stood to its right and masked the slack; alone, those extra 50px read
// as an empty leftover column. Longer names still wrap, clamped at two lines.
const COL = {
  trend: 40,
  title: 200,
  goal: 80,
  avg: 76,
} as const;

const LEFT = {
  trend: 0,
  title: COL.trend,
  goal: COL.trend + COL.title,
  avg: COL.trend + COL.title + COL.goal,
} as const;

const FROZEN_WIDTH = COL.trend + COL.title + COL.goal + COL.avg;

/** Count of frozen columns — keep in sync with COL. */
const FROZEN_COLS = 4;

// Faint separators between week columns — without them the wide value area
// reads as loose numbers floating in whitespace.
const weekDivider = "border-l border-zinc-100 dark:border-zinc-800/60";

/** Sticky cell shell; pixel `left` is applied via style for exact offsets. */
function stickyCell(extra?: string) {
  return cn("sticky bg-white dark:bg-zinc-900", extra);
}

/**
 * Wrapper for the expanded trend panel: pinned to the scrollport (sticky
 * left-0 at the measured visible width) and deaf to horizontal wheel input —
 * the panel isn't part of the scrollable data, so side-scroll over it would
 * just move the period columns invisibly behind it.
 */
function PinnedPanel({
  width,
  children,
}: {
  width?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Native listener: React registers wheel as passive, which forbids
    // preventDefault.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div
      ref={ref}
      className="sticky left-0 p-3"
      style={width ? { width } : undefined}
    >
      {children}
    </div>
  );
}

export function ScorecardGrid({
  teamId,
  columns,
  metrics,
  entryByMetricWeek,
  members,
  showDelete = false,
  groups = [],
  interval = "weekly",
  compact = false,
  /** When true, skip the grid's own search strip (parent owns filters). */
  hideLocalSearch = false,
  /** Preserve metric order; skip section regrouping. */
  flatList = false,
  emptyHint,
}: {
  teamId: string;
  /** Newest first — weekly columns or rolled-up period columns. */
  columns: ScorecardColumn[];
  metrics: ScorecardMetric[];
  entryByMetricWeek: Map<string, number | null> | Record<string, number | null>;
  members: ScorecardMember[];
  showDelete?: boolean;
  /** Team's group docs — supply position so Compliance can sit below Weekly. */
  groups?: ScorecardGroup[];
  /** Which period this grid is showing; groups are per-period. */
  interval?: ScorecardGroup["interval"];
  compact?: boolean;
  hideLocalSearch?: boolean;
  flatList?: boolean;
  emptyHint?: string;
}) {
  const gridId = useId();
  const [search, setSearch] = useState("");
  // Which rows have their trend panel open. Local on purpose: a reload
  // collapses everything, same as the rock row.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Visible width inside a group's frame. The expanded trend panel is sized to
  // this and pinned with sticky left-0, so it stays fully in view while the
  // period columns scroll behind it. Measured on the stack rather than on a
  // frame because every group is the stack's width; the 2px is the frame's own
  // left and right borders, which the panel does not get to sit on.
  const stackRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    // ResizeObserver fires once on observe, so no synchronous first measure.
    const ro = new ResizeObserver(() =>
      setViewWidth(Math.max(0, el.clientWidth - 2)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const entryMap = useMemo(() => {
    if (entryByMetricWeek instanceof Map) return entryByMetricWeek;
    return new Map(Object.entries(entryByMetricWeek));
  }, [entryByMetricWeek]);

  const ownerName = (id: string | null) =>
    ownerLabel(id, (x) => members.find((m) => m.user_id === x)?.full_name);

  const filtered = useMemo(() => {
    if (hideLocalSearch) return metrics;
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
  }, [metrics, search, members, hideLocalSearch]);

  // Bucketing preserves `filtered`'s order, which is the caller's sort — so
  // in the L10 each group renders its own speaking round.
  const { ungrouped, groups: metricGroups } = useMemo(
    () =>
      bucketMetricsByGroup(filtered, flatList, (names) =>
        orderGroupNames(names, groups, interval),
      ),
    [filtered, flatList, groups, interval],
  );

  const stickyShadow =
    "shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_6px_-2px_rgba(0,0,0,0.35)]";

  const headerBg = "bg-zinc-50 dark:bg-zinc-950";
  const totalCols = FROZEN_COLS + columns.length + (showDelete ? 1 : 0);

  const renderMetricRow = (m: ScorecardMetric) => {
    const values = columns.map((c) => entryMap.get(`${m.id}__${c.id}`) ?? null);
    const avg = average(values);
    const avgOnTrack = onTrack(avg, m.goal, m.direction);
    const status = trendStatus(values, m.goal, m.direction);
    const tone = STATUS_TONE[status];
    const open = openIds.has(m.id);
    const { hit, recorded, pct, applicable: hitApplies } = hitRate(
      values,
      m.goal,
      m.direction,
    );
    const owner = ownerName(m.owner_id);

    const avgTone =
      avgOnTrack == null
        ? "text-zinc-600 dark:text-zinc-400"
        : avgOnTrack
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-red-700 dark:text-red-300";

    return (
      <Fragment key={m.id}>
        <tr
          className={cn(
            "group border-b border-zinc-200 dark:border-zinc-800 last:border-0",
            open && "bg-hpb-blue/[0.03]",
          )}
        >
          <td
            className={cn(
              stickyCell(),
              "z-10 border-l-[3px] px-2 py-2.5 align-middle",
              tone.railBorder,
            )}
            style={{ left: LEFT.trend, width: COL.trend, minWidth: COL.trend }}
          >
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => toggleOpen(m.id)}
                aria-expanded={open}
                aria-label={open ? "Hide trend" : "Show trend"}
                title={`Show ${columns.length}-period trend`}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform",
                    open && "rotate-90",
                  )}
                />
              </button>
            </div>
          </td>

          <td
            className={cn(stickyCell(), "z-10 px-3 py-2.5 align-middle")}
            style={{
              left: LEFT.title,
              width: COL.title,
              minWidth: COL.title,
              // Hard cap. Without it a long measurable name grew the cell,
              // desynced the frozen block from the week header, and shoved
              // the week columns out of view.
              maxWidth: COL.title,
            }}
          >
            {/* Wraps rather than truncates — but clamped at two lines so a
              paragraph-length measurable can't make its row twice the height
              of its neighbors. Full text on hover. */}
            <div
              className="line-clamp-2 break-words font-medium text-zinc-900 dark:text-zinc-100"
              title={m.name}
            >
              {m.name}
            </div>
            <div
              className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400"
              title={owner}
            >
              {owner}
            </div>
            <div className="mt-1 flex items-center gap-2">
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
            </div>
          </td>

          <td
            className={cn(
              stickyCell(),
              "z-10 px-2 py-2.5 text-right align-middle tabular-nums text-zinc-600 dark:text-zinc-400",
            )}
            style={{ left: LEFT.goal, width: COL.goal, minWidth: COL.goal }}
          >
            {formatGoal(m.goal, m.direction, m.unit)}
          </td>

          <td
            className={cn(
              stickyCell(),
              stickyShadow,
              "z-10 px-2 py-2.5 text-right align-middle font-medium tabular-nums",
              avgTone,
            )}
            style={{ left: LEFT.avg, width: COL.avg, minWidth: COL.avg }}
            title={
              avg == null
                ? "No entries yet"
                : `${formatValueExact(avg, m.unit)} — average of ${values.filter((v) => v != null).length} recorded periods`
            }
          >
            {formatValue(avg, m.unit)}
          </td>

          {columns.map((col, i) => {
            const v = values[i] ?? null;
            const isCurrent = col.isCurrent;
            // period start key (weekly Monday / month 1st / …)
            const periodStart = col.id;
            return (
              <td
                key={col.id}
                className={cn(
                  "px-1 py-1 align-middle",
                  weekDivider,
                  isCurrent && "bg-sky-50/40 dark:bg-sky-950/15",
                )}
              >
                <ValueCell
                  teamId={teamId}
                  metricId={m.id}
                  weekStartDate={periodStart}
                  initial={v}
                  unit={m.unit}
                  onTrack={onTrack(v, m.goal, m.direction)}
                  isCurrentWeek={isCurrent}
                />
              </td>
            );
          })}

          {showDelete && (
            <td className="px-2 py-2 text-right">
              <ConfirmSubmitForm
                action={deleteMetric.bind(null, teamId, m.id)}
                confirmMessage="Delete this metric? This will remove it from the scorecard, including its logged history. This can't be undone."
              >
                <button
                  type="submit"
                  className="text-zinc-300 opacity-0 group-hover:opacity-100 dark:text-zinc-600 hover:text-red-600"
                  aria-label="Delete metric"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </ConfirmSubmitForm>
            </td>
          )}
        </tr>
        {open && (
          <tr className="bg-hpb-blue/[0.03]">
            <td colSpan={totalCols} className="p-0">
              <PinnedPanel width={viewWidth ?? undefined}>
                <MetricExpand
                  metric={m}
                  ownerName={owner}
                  columns={columns}
                  values={values}
                  // The p-3 gutter around the card costs 24px of the pinned width.
                  panelWidth={viewWidth ? viewWidth - 24 : undefined}
                />
              </PinnedPanel>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  // One group, one table (client, 8/31). A banded header row inside a single
  // table was too weak a break — Weekly and Compliance have to read as two
  // separate tables at a glance, so each group is its own <table> under its
  // own heading, repeating the period header so the block stands alone.
  //
  // Alignment across those tables is not left to content: every table is
  // `table-fixed w-full` inside one min-width stack, so the frozen columns
  // keep their pixel widths and the period columns split the same remainder.
  // One scroller wraps the lot, so the whole scorecard side-scrolls as a unit
  // and the frozen columns stay stuck across every block.
  const sections = useMemo(() => {
    const out: { key: string; name: string | null; items: ScorecardMetric[] }[] =
      [];
    // Ungrouped rows lead, unheaded — a team with no groups gets exactly the
    // single table it had before.
    if (ungrouped.length > 0) {
      out.push({ key: "__ungrouped__", name: null, items: ungrouped });
    }
    for (const g of metricGroups) {
      out.push({ key: `group:${g.name}`, name: g.name, items: g.items });
    }
    return out;
  }, [ungrouped, metricGroups]);

  const renderHead = () => (
    <thead>
      <tr className={cn(headerBg, "text-xs text-zinc-600 dark:text-zinc-400")}>
        <th
          className={cn(
            stickyCell(headerBg),
            "z-40 border-b border-zinc-200 px-1 py-2 font-medium dark:border-zinc-800",
          )}
          style={{
            left: LEFT.trend,
            width: COL.trend,
            minWidth: COL.trend,
          }}
          title="Recent trend vs goal"
        >
          <span className="sr-only">Trend</span>
        </th>
        <th
          className={cn(
            stickyCell(headerBg),
            "z-40 border-b border-zinc-200 px-3 py-2 text-left font-medium dark:border-zinc-800",
          )}
          style={{
            left: LEFT.title,
            width: COL.title,
            minWidth: COL.title,
            maxWidth: COL.title,
          }}
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
        {columns.map((col) => {
          const isCurrent = col.isCurrent;
          return (
            <th
              key={col.id}
              className={cn(
                "border-b border-zinc-200 px-2 py-2 text-center font-medium tabular-nums dark:border-zinc-800",
                headerBg,
                weekDivider,
                isCurrent && "text-hpb-blue dark:text-hpb-gold",
              )}
            >
              {isCurrent && (
                <span className="mb-0.5 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-hpb-blue dark:bg-hpb-gold" />
                  Current
                </span>
              )}
              <span className="block whitespace-nowrap">{col.label}</span>
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
  );

  return (
    <div className="space-y-3">
      {!hideLocalSearch && (
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
      )}

      {/* One scroll container per group, not one for the grid. A border only
          holds still if it is on the scrollport — anything inside scrolls —
          so a frame per group means a scrollport per group. They scroll
          independently on purpose (client, 8/31): a group is read on its own,
          and pinning them together meant scrolling one moved all the rest.
          The trade-off is that two groups scrolled to different weeks no
          longer line up column-for-column. */}
      <div
        ref={stackRef}
        className={cn(
          "space-y-5",
          // Only the L10 segment is a bounded box, so one segment cannot take
          // over the meeting page. The standalone tab lets the page scroll:
          // a 605px scroll box nested in a page that itself only moved 58px
          // trapped every bit of travel inside the grid, and the bottom of an
          // expanded trend chart could sit below the fold with the inner box
          // already at its limit (client, 8/31).
          compact && "max-h-[min(60vh,28rem)] overflow-y-auto overflow-x-hidden",
        )}
      >
        {sections.length === 0 ? (
          <div className="rounded-xl border border-zinc-300 bg-white px-4 py-10 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {metrics.length === 0
              ? (emptyHint ?? "No metrics yet.")
              : (emptyHint ?? "No measurables match your search.")}
          </div>
        ) : (
          sections.map((section, si) => {
            const headingId = `${gridId}-group-${si}`;
            return (
              <section
                key={section.key}
                aria-labelledby={section.name ? headingId : undefined}
              >
                {section.name && (
                  // Outside the scroller, so it never moves horizontally.
                  <div className="mb-1.5 flex w-max items-center gap-2 border-l-[3px] border-hpb-blue pl-2 dark:border-hpb-gold">
                    <h3
                      id={headingId}
                      className="text-[13px] font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200"
                    >
                      {section.name}
                    </h3>
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200 px-1.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {section.items.length}
                    </span>
                  </div>
                )}
                {/* This div is both the group's frame and its scrollport, which
                    is the whole point: the border cannot scroll out from under
                    the rows because the rows scroll inside it. */}
                {/* overscroll-x-none suppresses the elastic bounce past either
                    end. The rubber-band translates the whole scroll content and
                    the frozen columns are sticky against the scrollport, so
                    they used to get dragged along with it. It also stops a
                    horizontal trackpad swipe triggering browser-back. Vertical
                    chaining is untouched, so the page still scrolls on. */}
                <div className="overflow-x-auto overscroll-x-none rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  {/* Fixed layout: frozen columns keep their design widths (so
                      sticky offsets stay true) and leftover space spreads
                      evenly across the period columns. Every group carries the
                      same min-width inside an equal-width frame, so the columns
                      resolve identically — blocks left at the same scroll
                      offset line up. The 112px floor keeps "Jul 27 – Aug 2"
                      from overflowing. */}
                  <table
                    className="w-full table-fixed border-separate border-spacing-0 text-sm"
                    style={{ minWidth: FROZEN_WIDTH + columns.length * 112 }}
                  >
                    {renderHead()}
                    <tbody>{section.items.map(renderMetricRow)}</tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
