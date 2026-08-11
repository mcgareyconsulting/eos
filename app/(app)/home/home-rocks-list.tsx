"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Target } from "lucide-react";
import { daysUntil, formatDateOnly } from "@/lib/dates";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

export type HomeRockListItem = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  quarter: string;
  team_id: string;
  href: string;
  /** Team acronym or person initials/name */
  pillLabel: string;
  pillTitle?: string;
  pillKind: "team" | "person";
  milestones: HomeMilestoneListItem[];
};

export type HomeMilestoneListItem = {
  id: string;
  title: string;
  due_date: string | null;
  isMine: boolean;
};

/**
 * Rocks column: collapsed by default; expand shows all milestones with
 * the viewer's milestones highlighted.
 */
export function HomeRocksList({ rocks }: { rocks: HomeRockListItem[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rocks.length === 0) {
    return (
      <p className="px-3.5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No rocks to show.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {rocks.map((r) => {
        const expanded = open.has(r.id);
        const hasMs = r.milestones.length > 0;
        return (
          <li key={r.id}>
            <div className="flex items-start gap-1 px-2 py-2.5 sm:px-3">
              <button
                type="button"
                onClick={() => hasMs && toggle(r.id)}
                disabled={!hasMs}
                aria-expanded={expanded}
                aria-label={
                  hasMs
                    ? expanded
                      ? `Collapse milestones for ${r.title}`
                      : `Expand milestones for ${r.title}`
                    : undefined
                }
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  hasMs
                    ? "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    : "text-zinc-300 dark:text-zinc-700",
                )}
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform",
                    expanded && "rotate-90",
                  )}
                />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={r.href}
                      className="block truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      {r.title}
                    </Link>
                    {r.quarter ? (
                      <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {r.quarter}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <ContextPill
                        label={r.pillLabel}
                        title={r.pillTitle}
                        kind={r.pillKind}
                      />
                      <StatusBadge status={r.status} />
                      <DueLabel due={r.due_date} />
                      {hasMs ? (
                        <span className="text-xs text-zinc-500">
                          {r.milestones.length} milestone
                          {r.milestones.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {expanded && hasMs ? (
                  <ul className="mt-2 ml-6 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-700">
                    {r.milestones.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-sm",
                          m.isMine
                            ? "bg-hpb-blue/10 ring-1 ring-hpb-blue/25 dark:bg-hpb-blue/20 dark:ring-hpb-blue/40"
                            : "text-zinc-700 dark:text-zinc-300",
                        )}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <span
                            className={cn(
                              "min-w-0",
                              m.isMine &&
                                "font-medium text-zinc-900 dark:text-zinc-50",
                            )}
                          >
                            {m.isMine ? (
                              <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-hpb-blue dark:text-hpb-gold">
                                You
                              </span>
                            ) : null}
                            {m.title}
                          </span>
                          <DueLabel due={m.due_date} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ContextPill({
  label,
  title,
  kind,
}: {
  label: string;
  title?: string;
  kind: "team" | "person";
}) {
  return (
    <span
      title={title || label}
      className={cn(
        // Wider max so full team / owner names stay readable; still truncates
        // very long labels with the title tooltip as backup.
        "inline-flex max-w-[14rem] truncate rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        kind === "team"
          ? "bg-hpb-gold/15 text-hpb-brown ring-hpb-gold/40 dark:bg-hpb-gold/20 dark:text-hpb-gold"
          : "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
      )}
    >
      {label}
    </span>
  );
}

function DueLabel({ due }: { due: string | null }) {
  if (!due)
    return (
      <span className="text-xs whitespace-nowrap text-zinc-500">No due</span>
    );
  const overdue = daysUntil(due) < 0;
  return (
    <span
      className={
        "text-xs whitespace-nowrap " +
        (overdue ? "text-red-600" : "text-zinc-600 dark:text-zinc-400")
      }
    >
      Due {formatDateOnly(due)}
    </span>
  );
}
