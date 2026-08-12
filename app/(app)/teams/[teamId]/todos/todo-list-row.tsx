"use client";

import { useState } from "react";
import { Archive, Lock, Trash2 } from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { cn } from "@/lib/utils";
import { formatDateOnly, formatDateShort } from "@/lib/dates";
import { dueToneClass } from "@/lib/due";
import { normalizeDescription } from "@/lib/csv-import";
import { RichText } from "@/components/rich-text";
import { TodoCheckbox } from "./todo-row";
import { EditTodoDrawer } from "./edit-todo-drawer";
import { deleteTodo, setTodoArchived } from "./actions";

export type TodoListItem = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  visibility: "team" | "private";
  archived?: boolean;
  /** Local mm/dd/yyyy when archived (from archived_at). */
  closed_on?: string | null;
};

type Member = { user_id: string; full_name: string };

// View-first row: click the title to expand description.
// Checkbox / pencil / delete stay separate.
export function TodoListRow({
  teamId,
  todo,
  ownerName,
  members,
  /** Owner cards already name the owner — don't repeat it on every row. */
  hideOwner = false,
}: {
  teamId: string;
  todo: TodoListItem;
  ownerName: string;
  members: Member[];
  hideOwner?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const remove = deleteTodo.bind(null, teamId, todo.id);
  const toggleArchive = setTodoArchived.bind(
    null,
    teamId,
    todo.id,
    !todo.archived,
  );
  // Restore label/body breaks lost in ninety xlsx exports (e.g. "Analytical"
  // glued onto the paragraph) so whitespace-pre-wrap can render them.
  const description = normalizeDescription(todo.description);
  const hasDescription = description.length > 0;

  function toggleExpanded() {
    setExpanded((e) => !e);
  }

  // Active/L10: completed = checked box only (no strikethrough — stays readable).
  // Archived: no checkbox; "Closed On" date instead of heavy grayout.
  const archived = !!todo.archived;

  // Mid-week complete (not yet archived): gray row until Monday / Finish.
  const closedPending = !archived && todo.completed;

  return (
    <div
      className={cn(
        "group px-4 py-2.5 text-sm",
        closedPending &&
          "bg-zinc-50/90 text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400",
      )}
    >
      <div className="flex items-start gap-3">
        {!archived && (
          <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <TodoCheckbox
              teamId={teamId}
              todoId={todo.id}
              completed={todo.completed}
              appearance="milestone"
            />
          </div>
        )}

        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="-mx-1 min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <span
            className={cn(
              "font-medium text-zinc-900 dark:text-zinc-100",
              closedPending && "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {todo.title}
          </span>
          {todo.visibility === "private" && (
            <span
              className="ml-1.5 inline-flex translate-y-px items-center text-zinc-400"
              title="Private — only you can see this to-do"
            >
              <Lock className="h-3 w-3" />
              <span className="sr-only">Private</span>
            </span>
          )}
          {archived && (
            <span className="mt-0.5 block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              Closed {todo.closed_on ?? "—"}
            </span>
          )}
        </button>

        {!hideOwner && (
          <div className="w-28 shrink-0 pt-0.5 text-right text-xs text-zinc-600 dark:text-zinc-400">
            {ownerName}
          </div>
        )}
        <div
          className={cn(
            "w-14 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums",
            archived
              ? "text-zinc-400 dark:text-zinc-500"
              : dueToneClass(todo.due_date, todo.completed),
          )}
        >
          {formatDateShort(todo.due_date)}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {!archived && (
            <EditTodoDrawer teamId={teamId} todo={todo} members={members} />
          )}
          <form action={toggleArchive}>
            <button
              type="submit"
              className="rounded p-1 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={archived ? "Restore to-do" : "Archive to-do"}
              title={
                archived
                  ? "Restore to Active"
                  : "Archive now (done items also archive when the L10 ends)"
              }
            >
              <Archive className="h-4 w-4" />
            </button>
          </form>
          {!archived && (
            <ConfirmSubmitForm
              action={remove}
              confirmMessage="Delete this to-do? This can't be undone."
            >
              <button
                type="submit"
                className="rounded p-1 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
                aria-label="Delete to-do"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </ConfirmSubmitForm>
          )}
        </div>
      </div>

      {expanded && (
        <div
          className={cn(
            "mt-3 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800",
            archived ? "ml-1" : "ml-7",
          )}
        >
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Description
            </h4>
            {hasDescription ? (
              <RichText
                value={description}
                className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400"
              />
            ) : (
              <p className="text-xs italic text-zinc-400">No description.</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {hideOwner ? null : (
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
                {todo.due_date ? formatDateOnly(todo.due_date) : "—"}
              </dd>
            </div>
            {todo.visibility === "private" && (
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Visibility
                </dt>
                <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                  Private
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
