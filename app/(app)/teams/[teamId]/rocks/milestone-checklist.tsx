"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/dates";
import { TodoCheckbox } from "../todos/todo-row";
import { dueToneClass } from "@/lib/due";

// Plain-data shape passed from the Server Component (unchanged from
// milestones.tsx — Firestore Timestamps can't cross the RSC boundary, so the
// parent serializes `completed_at` to a boolean).
export type MilestoneSerialized = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  description: string | null;
  /** Pre-resolved owner name, for callers that never had the roster (L10).
   *  Wins over looking `owner_id` up in `members`. */
  owner_label?: string | null;
};

type Member = { user_id: string; full_name: string };

/**
 * Read-and-tick milestone list. No add form, no inline editing — creating and
 * editing milestones happens in RockModal now, which is what removes the
 * clutter from the expanded row.
 *
 * `teamId` omitted → static indicators (used where no server action is wired,
 * e.g. the live L10 detail modal).
 */
export function MilestoneChecklist({
  teamId,
  members,
  milestones,
  variant = "row",
}: {
  teamId?: string;
  members?: Member[];
  milestones: MilestoneSerialized[];
  variant?: "row" | "modal";
}) {
  if (milestones.length === 0) return null;

  const nameFor = (m: MilestoneSerialized) => {
    if (m.owner_label) return m.owner_label;
    if (!m.owner_id) return "—";
    return members?.find((x) => x.user_id === m.owner_id)?.full_name ?? "—";
  };

  return (
    <ul
      className={cn(
        variant === "modal" &&
          "divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800",
      )}
    >
      {milestones.map((m) => (
        <li key={m.id}>
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5",
              variant === "modal"
                ? "px-3.5 py-2.5 text-[13.5px] hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                : "rounded-md px-1.5 py-1 text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800",
              m.completed && variant === "modal" && "bg-zinc-50 dark:bg-zinc-800/40",
            )}
          >
            {teamId ? (
              <TodoCheckbox
                teamId={teamId}
                todoId={m.id}
                completed={m.completed}
              />
            ) : (
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ring-inset",
                  m.completed
                    ? "bg-hpb-green text-white ring-hpb-green"
                    : "ring-zinc-300 dark:ring-zinc-600",
                )}
                aria-hidden
              >
                {m.completed && <Check className="h-3 w-3" strokeWidth={3.4} />}
              </span>
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                m.completed
                  ? "text-zinc-400 line-through dark:text-zinc-500"
                  : "text-zinc-800 dark:text-zinc-200",
              )}
              title={m.description ?? undefined}
            >
              {m.title}
            </span>
            <span className="shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              {nameFor(m)}
            </span>
            <span
              className={cn(
                "w-16 shrink-0 text-right text-[11.5px] tabular-nums",
                dueToneClass(m.due_date, m.completed),
              )}
            >
              {formatDateShort(m.due_date)}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** "3/5" progress bar + count, colored by the rock's status. */
export function MilestoneProgress({
  milestones,
  barClass,
}: {
  milestones: { completed: boolean }[];
  /** STATUS_BAR[status] */
  barClass: string;
}) {
  const total = milestones.length;
  const done = milestones.filter((m) => m.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative block h-1 w-[52px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <span
          className={cn("absolute inset-y-0 left-0", barClass)}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
        {done}/{total}
      </span>
    </span>
  );
}
