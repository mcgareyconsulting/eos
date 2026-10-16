"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  dueDateShort,
  formatDateShort,
  relativeDueLabel,
} from "@/lib/dates";
import { dueToneClass, urgencyChipClass } from "@/lib/due";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  STATUS_BAR,
  isRockStatus,
  type RockStatus,
} from "@/app/(app)/teams/[teamId]/rocks/status";
import { TodoCheckbox } from "@/app/(app)/teams/[teamId]/todos/todo-row";
import {
  MilestoneExpansion,
  useExpandedMilestones,
} from "@/app/(app)/teams/[teamId]/rocks/milestone-expansion";

export type HomeRockListItem = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  quarter: string;
  team_id: string;
  /** The parent team's Rocks page, when the viewer can open it. */
  href: string | null;
  /**
   * Headline view (spec §3.3): the viewer is assigned a milestone but is
   * not on the parent team or in the audience. The server sends only the
   * title, owner and team plus the viewer's own milestones — no status, due
   * date or progress.
   */
  headline?: boolean;
  /**
   * All three feed the Company / My / Team split (lib/rock-bucket.ts)
   * — a legacy rock with no owner counts as departmental, so owner_id is not
   * optional here.
   */
  owner_id: string | null;
  rock_type: string | null;
  is_company_rock: boolean;
  /** "You", person name, or team name for department rocks */
  ownerLabel: string;
  milestoneDone: number;
  milestoneTotal: number;
  milestones: HomeMilestoneListItem[];
};

export type HomeMilestoneListItem = {
  id: string;
  title: string;
  due_date: string | null;
  /** Resolved display name; "You" when viewer owns it */
  ownerLabel: string;
  isMine: boolean;
  /** Rich text, shown read-only when the milestone is expanded. */
  description?: string | null;
  /**
   * Set on the viewer's own milestones: the team the tick runs through
   * (toggleTodo checks access to it; milestoneAccess.canComplete lets an
   * assignee tick their own from any of their teams). Home is the one place
   * every assignee sees their milestone, so it is tickable here.
   */
  tickTeamId?: string;
};

const ROCK_COLS =
  "grid grid-cols-[24px_minmax(0,1fr)_116px_110px_96px_88px] gap-2.5";

/**
 * Rocks column: 6-column table (3a). Expand shows milestones in-column
 * with a status rail; viewer's milestones use blue "You" in the owner cell.
 *
 * A milestone's name opens it in place (MilestoneExpansion: description and
 * activity feed). Every milestone listed here is one the viewer may comment
 * on: a full rock's (seesFullRock) or, on a headline rock, only their own
 * (the assignee) — milestoneAccess.canComment covers both.
 */
export function HomeRocksList({
  rocks,
  userId,
}: {
  rocks: HomeRockListItem[];
  /** The viewer, for the milestone feeds. */
  userId: string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const expandMs = useExpandedMilestones();

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
      <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No rocks to show.
      </p>
    );
  }

  return (
    <div>
      <div
        className={cn(
          ROCK_COLS,
          "border-b border-zinc-100 bg-zinc-50 px-4 py-[7px] dark:border-zinc-800 dark:bg-zinc-800/50",
        )}
      >
        <div aria-hidden />
        {(
          [
            ["Rock", ""],
            ["Owner", ""],
            ["Progress", ""],
            ["Due", ""],
            ["Status", "text-right"],
          ] as const
        ).map(([label, align]) => (
          <div
            key={label}
            className={cn(
              "text-[9.5px] font-extrabold uppercase tracking-[0.07em] text-zinc-400",
              align,
            )}
          >
            {label}
          </div>
        ))}
      </div>

      <ul>
        {rocks.map((r) => {
          const expanded = open.has(r.id);
          const hasMs = r.milestones.length > 0;
          const status: RockStatus = isRockStatus(r.status)
            ? r.status
            : "on_track";
          const bar = STATUS_BAR[status];
          const total = r.milestoneTotal;
          const done = r.milestoneDone;
          const pct = total ? Math.round((done / total) * 100) : 0;

          return (
            <li
              key={r.id}
              className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
            >
              <div
                className={cn(
                  ROCK_COLS,
                  "items-center px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
                )}
              >
                <div className="flex h-6 w-6 items-center justify-center">
                  {hasMs ? (
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse milestones for ${r.title}`
                          : `Expand milestones for ${r.title}`
                      }
                      className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 transition-transform",
                          expanded && "rotate-90",
                        )}
                      />
                    </button>
                  ) : null}
                </div>

                {r.href ? (
                  <Link
                    href={r.href}
                    className="min-w-0 truncate text-[13.5px] font-bold text-zinc-900 hover:underline dark:text-zinc-100"
                  >
                    {r.title}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-[13.5px] font-bold text-zinc-900 dark:text-zinc-100">
                    {r.title}
                  </span>
                )}

                <div className="truncate text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  {r.ownerLabel}
                </div>

                <div className="flex items-center gap-1.5">
                  {r.headline ? (
                    <span className="text-[11px] font-semibold text-zinc-500">
                      Your milestone
                    </span>
                  ) : total > 0 ? (
                    <>
                      <span className="relative block h-[4.5px] w-[58px] overflow-hidden rounded-full bg-[#ececee] dark:bg-zinc-700">
                        <span
                          className={cn("absolute inset-y-0 left-0", bar)}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="text-[11px] font-bold tabular-nums text-zinc-500">
                        {done}/{total}
                      </span>
                    </>
                  ) : null}
                </div>

                <div className="min-w-0">
                  {r.headline ? null : r.due_date ? (
                    <>
                      <div className="text-[12.5px] tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatDateShort(r.due_date)}
                      </div>
                      <div
                        className={cn(
                          "text-[10px] font-bold",
                          dueToneClass(r.due_date, status === "done"),
                        )}
                      >
                        {relativeDueLabel(r.due_date)}
                      </div>
                    </>
                  ) : (
                    <span className="text-[12.5px] text-zinc-400">—</span>
                  )}
                </div>

                <div className="justify-self-end">
                  {r.headline ? null : <StatusBadge status={status} compact />}
                </div>
              </div>

              {expanded && hasMs ? (
                <div className="flex border-t border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/30">
                  <div className={cn("w-[3px] shrink-0", bar)} aria-hidden />
                  <ul className="min-w-0 flex-1 py-1">
                    {r.milestones.map((m, i) => (
                      <li
                        key={m.id}
                        className={cn(
                          i > 0 &&
                            "border-t border-zinc-100 dark:border-zinc-800",
                        )}
                      >
                        <div className="grid grid-cols-[21px_minmax(0,1fr)_116px_110px_96px_88px] items-center gap-2.5 px-4 py-[7px]">
                          <div className="flex justify-center">
                            {m.tickTeamId ? (
                              <TodoCheckbox
                                teamId={m.tickTeamId}
                                todoId={m.id}
                                completed={false}
                                appearance="milestone"
                                guardDraft
                              />
                            ) : (
                              <span
                                className="h-[13px] w-[13px] rounded-full border-[1.5px] border-zinc-300 dark:border-zinc-600"
                                aria-hidden
                              />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => expandMs.toggle(m.id)}
                            aria-expanded={expandMs.isOpen(m.id)}
                            className="flex min-w-0 items-center gap-1 text-left text-[12.5px] font-semibold text-zinc-600 hover:text-hpb-blue dark:text-zinc-300 dark:hover:text-hpb-gold"
                          >
                            <span className="min-w-0 truncate">{m.title}</span>
                          </button>
                          <div
                            className={cn(
                              "truncate text-[11.5px]",
                              m.isMine
                                ? "font-extrabold text-hpb-blue"
                                : "font-semibold text-zinc-500 dark:text-zinc-400",
                            )}
                          >
                            {m.ownerLabel}
                          </div>
                          <div />
                          <div
                            className={cn(
                              "text-[11.5px] font-semibold tabular-nums",
                              dueToneClass(m.due_date),
                            )}
                          >
                            {dueDateShort(m.due_date)}
                          </div>
                          <div className="justify-self-end">
                            {m.due_date ? (
                              <span className={urgencyChipClass(m.due_date)}>
                                {relativeDueLabel(m.due_date)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <MilestoneExpansion
                          open={expandMs.isOpen(m.id)}
                          draftKey={m.id}
                          teamId={m.tickTeamId ?? r.team_id}
                          userId={userId}
                          milestoneId={m.id}
                          description={m.description}
                          className="mb-2.5 ml-[47px] mr-4 rounded-[10px] border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Re-export for callers that want the chip without importing due.ts. */
export { urgencyChipClass };
