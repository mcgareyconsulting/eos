"use client";

import { formatDateShort } from "@/lib/dates";
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

export function MilestoneTodoRow({
  teamId,
  milestone,
  ownerName,
}: {
  teamId: string;
  milestone: MilestoneTodoItem;
  ownerName: string;
}) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-[11px] text-sm">
      <TodoCheckbox
        teamId={teamId}
        todoId={milestone.id}
        completed={milestone.completed}
        appearance="milestone"
      />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
          {milestone.title}
        </div>
        <div className="truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">
          {milestone.rock_title}
          {ownerName ? ` · ${ownerName}` : ""}
        </div>
      </div>
      <span
        className={cn(
          "text-[11.5px] font-bold tabular-nums whitespace-nowrap",
          dueToneClass(milestone.due_date, milestone.completed),
        )}
      >
        {milestone.due_date ? formatDateShort(milestone.due_date) : "—"}
      </span>
    </div>
  );
}
