"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { richTextToPlain } from "@/lib/rich-text";
import { formatDateShort, relativeDueLabel } from "@/lib/dates";
import { TodoCheckbox } from "../todos/todo-row";
import { dueToneClass, urgencyChipClass } from "@/lib/due";
import { ownerLabel } from "@/lib/user-name";

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
 * Always tickable. Milestones get checked off live during the L10 — that is
 * the point of walking the rocks — so there is no read-only mode to opt into.
 *
 * variant "row" = expanded rock row on team page.
 * variant "modal" = rock detail: open as cards, completed collapsed.
 */
export function MilestoneChecklist({
  teamId,
  members,
  milestones,
  variant = "row",
  readOnly = false,
}: {
  teamId: string;
  members?: Member[];
  milestones: MilestoneSerialized[];
  variant?: "row" | "modal";
  readOnly?: boolean;
}) {
  if (milestones.length === 0) return null;

  const nameFor = (m: MilestoneSerialized) => {
    if (m.owner_label) return m.owner_label;
    return ownerLabel(
      m.owner_id,
      (id) => members?.find((x) => x.user_id === id)?.full_name,
    );
  };

  if (variant === "modal") {
    return (
      <ModalMilestoneList
        teamId={teamId}
        milestones={milestones}
        nameFor={nameFor}
        readOnly={readOnly}
      />
    );
  }

  return (
    <ul>
      {milestones.map((m) => (
        <li key={m.id}>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2 py-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-800">
            <MilestoneTick
              teamId={teamId}
              todoId={m.id}
              completed={m.completed}
              readOnly={readOnly}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                m.completed
                  ? "text-zinc-400 dark:text-zinc-500"
                  : "font-medium text-zinc-800 dark:text-zinc-200",
              )}
              title={richTextToPlain(m.description) || undefined}
            >
              {m.title}
            </span>
            <span className="shrink-0 text-[11.5px] text-zinc-400">
              {nameFor(m)}
            </span>
            <span
              className={cn(
                "w-14 shrink-0 text-right text-[11.5px] tabular-nums",
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

function MilestoneTick({
  teamId,
  todoId,
  completed,
  readOnly,
}: {
  teamId: string;
  todoId: string;
  completed: boolean;
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <span
        className={cn(
          "inline-block h-4 w-4 shrink-0 rounded-sm border",
          completed
            ? "border-hpb-green bg-hpb-green"
            : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900",
        )}
        aria-hidden
      />
    );
  }
  return (
    <TodoCheckbox
      teamId={teamId}
      todoId={todoId}
      completed={completed}
      appearance="milestone"
    />
  );
}

function ModalMilestoneList({
  teamId,
  milestones,
  nameFor,
  readOnly,
}: {
  teamId: string;
  milestones: MilestoneSerialized[];
  nameFor: (m: MilestoneSerialized) => string;
  readOnly: boolean;
}) {
  const open = milestones.filter((m) => !m.completed);
  const done = milestones.filter((m) => m.completed);
  const [showDone, setShowDone] = useState(false);

  return (
    <div className="space-y-2">
      {open.map((m) => (
        <label
          key={m.id}
          className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-zinc-200 px-3.5 py-[11px] dark:border-zinc-700"
        >
          <MilestoneTick
            teamId={teamId}
            todoId={m.id}
            completed={m.completed}
            readOnly={readOnly}
          />
          <span
            className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-zinc-900 dark:text-zinc-100"
            title={richTextToPlain(m.description) || undefined}
          >
            {m.title}
          </span>
          <span className="shrink-0 text-[11.5px] text-zinc-400">
            {nameFor(m)}
          </span>
          {m.due_date ? (
            <span className={urgencyChipClass(m.due_date)}>
              {relativeDueLabel(m.due_date)}
            </span>
          ) : null}
        </label>
      ))}

      {done.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showDone && "rotate-90",
              )}
            />
            Completed ({done.length})
          </button>
          {showDone && (
            <ul className="mt-1.5 space-y-0.5 rounded-[10px] bg-zinc-50 p-1 dark:bg-zinc-800/50">
              {done.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-[11px] py-2">
                    <MilestoneTick
                      teamId={teamId}
                      todoId={m.id}
                      completed={m.completed}
                      readOnly={readOnly}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] text-zinc-400"
                      title={richTextToPlain(m.description) || undefined}
                    >
                      {m.title}
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-400">
                      {formatDateShort(m.due_date)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open.length === 0 && done.length === 0 && (
        <p className="text-[13px] italic text-zinc-400">No milestones yet.</p>
      )}
    </div>
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
      <span className="relative block h-1 w-11 overflow-hidden rounded-full bg-[#ececee] dark:bg-zinc-700">
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
