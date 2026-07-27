"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  WEEK_RANGE_OPTIONS,
  type WeekRange,
} from "@/lib/scorecard";

const PERIODS = [
  { id: "weekly", label: "Weekly", enabled: true },
  { id: "monthly", label: "Monthly", enabled: false },
  { id: "quarterly", label: "Quarterly", enabled: false },
  { id: "annual", label: "Annual", enabled: false },
] as const;

/**
 * Familiar scorecard chrome: period tabs + rolling-window control.
 * Monthly/Quarterly/Annual stay visible but disabled until interval
 * rollups land (roadmap Feature 2 / Pass 11 deferred items).
 */
export function ScorecardToolbar({
  weekRange,
  teamLabel,
}: {
  weekRange: WeekRange;
  teamLabel?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefForWeeks = (n: WeekRange) => {
    const params = new URLSearchParams(searchParams.toString());
    if (n === 13) params.delete("weeks");
    else params.set("weeks", String(n));
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!p.enabled}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              p.id === "weekly"
                ? "text-hpb-blue dark:text-hpb-gold"
                : "text-zinc-400 dark:text-zinc-500",
              !p.enabled && "cursor-not-allowed opacity-60",
            )}
            title={
              p.enabled
                ? undefined
                : "Coming soon — weekly is the live operating view"
            }
          >
            {p.label}
            {p.id === "weekly" && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-hpb-blue dark:bg-hpb-gold" />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {teamLabel && (
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            Team:{" "}
            <span className="ml-1 font-medium text-zinc-900 dark:text-zinc-100">
              {teamLabel}
            </span>
          </span>
        )}

        <span className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          View by: <span className="ml-1 font-medium">Week</span>
        </span>

        <div className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          <span className="pl-2.5 pr-1 text-sm text-zinc-500">Date range</span>
          {WEEK_RANGE_OPTIONS.map((n) => (
            <Link
              key={n}
              href={hrefForWeeks(n)}
              className={cn(
                "rounded-full px-2.5 py-1 text-sm font-medium transition-colors",
                n === weekRange
                  ? "bg-hpb-blue text-white dark:bg-hpb-gold dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
              aria-current={n === weekRange ? "true" : undefined}
            >
              Last {n} weeks
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
