"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { richTextToPlain } from "@/lib/rich-text";
import {
  dueDateShort,
  formatDateShort,
  relativeDueLabel,
} from "@/lib/dates";
import { TodoCheckbox } from "../todos/todo-row";
import { dueToneClass, urgencyChipClass } from "@/lib/due";
import { useTimeZone } from "@/components/time-zone-provider";
import { ownerLabel } from "@/lib/user-name";
import {
  MilestoneExpansion,
  useExpandedMilestones,
} from "./milestone-expansion";

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
 * With `userId`, a milestone's name is a toggle that opens it in place
 * (MilestoneExpansion: description + its activity feed). The tick beside it
 * is a separate control, so ticking never expands and expanding never
 * ticks. `onDraft` hands an unsent comment to a host dialog's discard guard.
 *
 * Tickable by everyone with the full rock (parent team, audience, admins).
 * On a read-only list the viewer still ticks their own milestone
 * (lib/access/rock.ts milestoneAccess.canComplete, which toggleTodo
 * enforces).
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
  currentUserId,
  userId,
  onDraft,
}: {
  teamId: string;
  members?: Member[];
  milestones: MilestoneSerialized[];
  variant?: "row" | "modal";
  readOnly?: boolean;
  currentUserId?: string;
  /** The viewer. Present = names expand to description + activity. */
  userId?: string;
  onDraft?: (key: string, hasDraft: boolean) => void;
}) {
  const expand = useExpandedMilestones();
  const timeZone = useTimeZone();
  if (milestones.length === 0) return null;
  const now = new Date();

  const lockedFor = (m: MilestoneSerialized) =>
    readOnly && !(currentUserId && m.owner_id === currentUserId);

  const nameFor = (m: MilestoneSerialized) => {
    if (m.owner_label) return m.owner_label;
    return ownerLabel(
      m.owner_id,
      (id) => members?.find((x) => x.user_id === id)?.full_name,
    );
  };

  // The panel a name opens, or nothing when this list does not expand.
  const panel = (m: MilestoneSerialized, className?: string) =>
    userId ? (
      <MilestoneExpansion
        open={expand.isOpen(m.id)}
        draftKey={m.id}
        teamId={teamId}
        userId={userId}
        members={members}
        milestoneId={m.id}
        description={m.description}
        onDraft={onDraft}
        className={className}
      />
    ) : null;
  const toggleFor = userId ? expand.toggle : undefined;

  if (variant === "modal") {
    return (
      <ModalMilestoneList
        teamId={teamId}
        milestones={milestones}
        nameFor={nameFor}
        lockedFor={lockedFor}
        isOpen={expand.isOpen}
        onToggle={toggleFor}
        panel={panel}
      />
    );
  }

  return (
    <ul>
      {milestones.map((m) => (
        <li key={m.id}>
          <div className="flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-800">
            <MilestoneTick
              teamId={teamId}
              todoId={m.id}
              completed={m.completed}
              readOnly={lockedFor(m)}
            />
            <MilestoneName
              milestone={m}
              open={expand.isOpen(m.id)}
              onToggle={toggleFor}
              className={cn(
                "text-[13px]",
                m.completed
                  ? "text-zinc-400 dark:text-zinc-500"
                  : "font-medium text-zinc-800 dark:text-zinc-200",
              )}
            />
            <span className="shrink-0 text-[11.5px] text-zinc-400">
              {nameFor(m)}
            </span>
            <span
              className={cn(
                "w-14 shrink-0 text-right text-[11.5px] tabular-nums",
                dueToneClass(m.due_date, m.completed, now, undefined, timeZone),
              )}
            >
              {dueDateShort(m.due_date, m.completed, now, timeZone)}
            </span>
          </div>
          {panel(
            m,
            "mb-2 ml-[34px] mr-2 mt-1 rounded-[10px] border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900",
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A milestone's name: a toggle for its expansion when the list expands
 * (`onToggle`), plain text otherwise. A sibling of the tick, never wrapping
 * it — a click on one does not reach the other.
 */
function MilestoneName({
  milestone: m,
  open,
  onToggle,
  className,
}: {
  milestone: MilestoneSerialized;
  open: boolean;
  onToggle?: (id: string) => void;
  className?: string;
}) {
  const hint = richTextToPlain(m.description) || undefined;
  if (!onToggle) {
    return (
      <span className={cn("min-w-0 flex-1 truncate", className)} title={hint}>
        {m.title}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onToggle(m.id)}
      aria-expanded={open}
      title={hint}
      className={cn(
        "-mx-1 flex min-w-0 flex-1 items-center gap-1 rounded px-1 text-left hover:text-hpb-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 dark:hover:text-hpb-gold",
        className,
      )}
    >
      <span className="min-w-0 truncate">{m.title}</span>
    </button>
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
      guardDraft
    />
  );
}

function ModalMilestoneList({
  teamId,
  milestones,
  nameFor,
  lockedFor,
  isOpen,
  onToggle,
  panel,
}: {
  teamId: string;
  milestones: MilestoneSerialized[];
  nameFor: (m: MilestoneSerialized) => string;
  lockedFor: (m: MilestoneSerialized) => boolean;
  isOpen: (id: string) => boolean;
  onToggle?: (id: string) => void;
  panel: (m: MilestoneSerialized, className?: string) => React.ReactNode;
}) {
  const open = milestones.filter((m) => !m.completed);
  const done = milestones.filter((m) => m.completed);
  const [showDone, setShowDone] = useState(false);
  const timeZone = useTimeZone();
  const now = new Date();

  return (
    <div className="space-y-2">
      {open.map((m) => (
        <div
          key={m.id}
          className="rounded-[10px] border border-zinc-200 dark:border-zinc-700"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-[11px]">
            <MilestoneTick
              teamId={teamId}
              todoId={m.id}
              completed={m.completed}
              readOnly={lockedFor(m)}
            />
            <MilestoneName
              milestone={m}
              open={isOpen(m.id)}
              onToggle={onToggle}
              className="text-[13.5px] font-bold text-zinc-900 dark:text-zinc-100"
            />
            <span className="shrink-0 text-[11.5px] text-zinc-400">
              {nameFor(m)}
            </span>
            {m.due_date ? (
              <span
                className={urgencyChipClass(
                  m.due_date,
                  false,
                  now,
                  undefined,
                  timeZone,
                )}
              >
                {relativeDueLabel(m.due_date, now, false, timeZone)}
              </span>
            ) : null}
          </div>
          {panel(
            m,
            "border-t border-zinc-100 px-3.5 pb-3.5 pt-3 dark:border-zinc-800",
          )}
        </div>
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
          {/* Hidden, not unmounted, while folded: an expanded milestone in
              here keeps a half-typed comment (MilestoneExpansion). */}
          <ul
            hidden={!showDone}
            className="mt-1.5 space-y-0.5 rounded-[10px] bg-zinc-50 p-1 dark:bg-zinc-800/50"
          >
            {done.map((m) => (
              <li key={m.id}>
                <div className="flex items-center gap-2.5 rounded-md px-[11px] py-2">
                  <MilestoneTick
                    teamId={teamId}
                    todoId={m.id}
                    completed={m.completed}
                    readOnly={lockedFor(m)}
                  />
                  <MilestoneName
                    milestone={m}
                    open={isOpen(m.id)}
                    onToggle={onToggle}
                    className="text-[13px] text-zinc-400"
                  />
                  <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-400">
                    {formatDateShort(m.due_date)}
                  </span>
                </div>
                {panel(m, "mx-1 mb-1 rounded-md bg-white p-3 dark:bg-zinc-900")}
              </li>
            ))}
          </ul>
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
