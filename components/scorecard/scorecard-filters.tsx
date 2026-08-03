"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  WEEK_RANGE_OPTIONS,
  type SortOption,
  type StatusFilter,
  type WeekRange,
} from "@/lib/scorecard";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";

function FilterSelect({
  id,
  label,
  value,
  active,
  onChange,
  children,
  className,
}: {
  id: string;
  label: string;
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={label}
        className={cn(
          "h-8 appearance-none rounded-full border py-0 pl-2.5 pr-7 text-xs font-medium",
          "border-zinc-300 bg-white text-zinc-800",
          "hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-hpb-blue/30",
          "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-hpb-gold/30",
          active &&
            "border-hpb-blue/40 bg-hpb-blue/5 text-hpb-blue dark:border-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold",
        )}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400"
        aria-hidden
      />
    </div>
  );
}

/**
 * Period tabs filter metrics by `metric.interval` (weekly/monthly/…).
 * Each tab is its own set of measurables + columns at that grain — not a
 * rollup view of weekly data.
 */
export function ScorecardFilters({
  period,
  weekRange,
  teamLabel,
  members,
  status,
  onStatusChange,
  ownerId,
  onOwnerChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  visibleCount,
  totalCount,
  compact = false,
  extra,
}: {
  period: ScorecardPeriod;
  weekRange: WeekRange;
  teamLabel?: string;
  members: { user_id: string; full_name: string }[];
  status: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  ownerId: string; // "" = all
  onOwnerChange: (v: string) => void;
  sort: SortOption;
  onSortChange: (v: SortOption) => void;
  search: string;
  onSearchChange: (v: string) => void;
  visibleCount: number;
  totalCount: number;
  /** Embedded contexts (the L10 segment): no period tabs. */
  compact?: boolean;
  /** Rendered at the end of the filter row (e.g. a quick-add button). */
  extra?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const q = params.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  };

  const setPeriod = (p: ScorecardPeriod) => {
    pushParams((params) => {
      if (p === "weekly") params.delete("period");
      else params.set("period", p);
    });
  };

  const setWeekRange = (n: WeekRange) => {
    pushParams((params) => {
      if (n === 13) params.delete("weeks");
      else params.set("weeks", String(n));
    });
  };

  const defaultSort: SortOption = compact ? "order" : "status";

  const defaults =
    status === "all" &&
    ownerId === "" &&
    sort === defaultSort &&
    weekRange === 13 &&
    search.trim() === "";

  const clearAll = () => {
    onStatusChange("all");
    onOwnerChange("");
    onSortChange(defaultSort);
    onSearchChange("");
    if (weekRange !== 13) setWeekRange(13);
  };

  const rangeHint =
    period === "weekly"
      ? null
      : period === "monthly"
        ? "Last 12 months"
        : period === "quarterly"
          ? "Last 8 quarters"
          : "Last 5 years";

  return (
    <div className="space-y-2.5">
      {!compact && (
        <div
          className="flex flex-wrap items-end gap-0.5 border-b border-zinc-200 dark:border-zinc-800"
          role="tablist"
          aria-label="Scorecard interval"
        >
          {SCORECARD_PERIODS.map((id) => {
            const selected = period === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPeriod(id)}
                className={cn(
                  "relative px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "text-hpb-blue dark:text-hpb-gold"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
                title={`Show ${PERIOD_LABELS[id].toLowerCase()} measurables`}
              >
                {PERIOD_LABELS[id]}
                {selected && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-hpb-blue dark:bg-hpb-gold" />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin]">
        {teamLabel && (
          <span
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
            title="Team is selected from the sidebar"
          >
            <span className="text-zinc-400 dark:text-zinc-500">Team</span>
            <span className="ml-1 max-w-[9rem] truncate font-medium text-zinc-800 dark:text-zinc-100">
              {teamLabel}
            </span>
          </span>
        )}

        {period === "weekly" ? (
          <FilterSelect
            id="sc-range"
            label="Date range"
            value={String(weekRange)}
            active={weekRange !== 13}
            onChange={(v) => setWeekRange(Number(v) as WeekRange)}
          >
            {WEEK_RANGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                Last {n} weeks
              </option>
            ))}
          </FilterSelect>
        ) : (
          <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {rangeHint}
          </span>
        )}

        <FilterSelect
          id="sc-status"
          label="Status"
          value={status}
          active={status !== "all"}
          onChange={(v) => onStatusChange(v as StatusFilter)}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          id="sc-owner"
          label="Owner"
          value={ownerId}
          active={ownerId !== ""}
          onChange={onOwnerChange}
        >
          <option value="">All owners</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          id="sc-sort"
          label="Sort"
          value={sort}
          active={sort !== "status"}
          onChange={(v) => onSortChange(v as SortOption)}
          className="min-w-[10.5rem]"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>

        <div className="relative ml-auto flex min-w-[10rem] max-w-xs shrink-0 flex-1 items-center sm:min-w-[14rem]">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search measurables…"
            className={cn(
              "h-8 w-full rounded-full border border-zinc-300 bg-white py-0 pl-8 pr-3 text-xs",
              "dark:border-zinc-700 dark:bg-zinc-900",
              "focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:focus:ring-hpb-gold/30",
              search.trim() &&
                "border-hpb-blue/40 bg-hpb-blue/5 dark:border-hpb-gold/40 dark:bg-hpb-gold/10",
            )}
            aria-label="Search measurables"
          />
        </div>

        <span className="hidden shrink-0 tabular-nums text-[11px] text-zinc-500 sm:inline dark:text-zinc-400">
          {visibleCount}
          {visibleCount !== totalCount ? `/${totalCount}` : ""} measurable
          {totalCount === 1 ? "" : "s"}
        </span>

        {!defaults && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-zinc-300 px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Reset filters"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}

        {extra && <div className="shrink-0">{extra}</div>}
      </div>
    </div>
  );
}
