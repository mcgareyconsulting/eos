"use client";

import { useState } from "react";
import { Lock, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import { normalizeDescription } from "@/lib/csv-import";
import { TodoCheckbox } from "./todo-row";
import { EditTodoDrawer } from "./edit-todo-drawer";
import { deleteTodo } from "./actions";

export type TodoListItem = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  visibility: "team" | "private";
};

type Member = { user_id: string; full_name: string };

// View-first row: click the title to expand description.
// Checkbox / pencil / delete stay separate.
export function TodoListRow({
  teamId,
  todo,
  ownerName,
  members,
}: {
  teamId: string;
  todo: TodoListItem;
  ownerName: string;
  members: Member[];
}) {
  const [expanded, setExpanded] = useState(false);
  const remove = deleteTodo.bind(null, teamId, todo.id);
  // Restore label/body breaks lost in ninety xlsx exports (e.g. "Analytical"
  // glued onto the paragraph) so whitespace-pre-wrap can render them.
  const description = normalizeDescription(todo.description);
  const hasDescription = description.length > 0;

  function toggleExpanded() {
    setExpanded((e) => !e);
  }

  return (
    <div className="group px-4 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <TodoCheckbox
            teamId={teamId}
            todoId={todo.id}
            completed={todo.completed}
          />
        </div>

        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="-mx-1 min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <span
            className={cn(
              "font-medium",
              todo.completed && "text-zinc-500 line-through",
            )}
          >
            {todo.title}
          </span>
          {todo.visibility === "private" && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-zinc-500">
              <Lock className="h-3 w-3" />
              private
            </span>
          )}
        </button>

        <div className="w-28 shrink-0 pt-0.5 text-right text-xs text-zinc-600 dark:text-zinc-400">
          {ownerName}
        </div>
        <div className="w-20 shrink-0 pt-0.5 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
          {todo.due_date ? formatDateOnly(todo.due_date) : "—"}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <EditTodoDrawer teamId={teamId} todo={todo} members={members} />
          <form action={remove}>
            <button
              type="submit"
              className="rounded p-1 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
              aria-label="Delete to-do"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-7 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Description
            </h4>
            {hasDescription ? (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {description}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-400">No description.</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Owner
              </dt>
              <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                {ownerName}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Due
              </dt>
              <dd className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">
                {todo.due_date ? formatDateOnly(todo.due_date) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Visibility
              </dt>
              <dd className="mt-0.5 capitalize text-zinc-700 dark:text-zinc-300">
                {todo.visibility}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
