"use client";

import { useState } from "react";
import { formatDateOnly, formatDateShort } from "@/lib/dates";
import { dueToneClass } from "@/lib/due";
import { cn } from "@/lib/utils";
import { TodoCheckbox } from "./todo-row";

export type MilestoneTodoItem = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  rock_title: string;
};

// Shares TodoListRow's row chrome (padding, checkbox gutter, title type, date
// column, click-to-expand) so the two board columns read as one table split in
// half. The parent rock is the expansion's payload: it repeats across every
// milestone of the same rock, so it earns a detail line, not a row subtitle.
export function MilestoneTodoRow({
  teamId,
  milestone,
  ownerName,
  /** Owner cards already name the owner — don't repeat it in the detail. */
  hideOwner = false,
}: {
  teamId: string;
  milestone: MilestoneTodoItem;
  ownerName: string;
  hideOwner?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group px-4 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <TodoCheckbox
            teamId={teamId}
            todoId={milestone.id}
            completed={milestone.completed}
            appearance="milestone"
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="-mx-1 min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {milestone.title}
          </span>
        </button>

        <div
          className={cn(
            // Matches TodoListRow's due column — see the note there.
            "w-14 shrink-0 pt-1 text-right text-xs font-semibold tabular-nums",
            dueToneClass(milestone.due_date, milestone.completed),
          )}
        >
          {formatDateShort(milestone.due_date)}
        </div>
      </div>

      {expanded && (
        <div className="ml-7 mt-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div className="col-span-2">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Rock
              </dt>
              {/* Full title, unwrapped — the row has no room for it. */}
              <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                {milestone.rock_title}
              </dd>
            </div>
            {!hideOwner && (
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Owner
                </dt>
                <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                  {ownerName}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Due
              </dt>
              <dd className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">
                {milestone.due_date ? formatDateOnly(milestone.due_date) : "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
