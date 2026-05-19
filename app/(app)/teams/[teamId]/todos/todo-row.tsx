"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle, Trash2, Lock } from "lucide-react";
import { toggleTodo, deleteTodo } from "./actions";
import { cn } from "@/lib/utils";
import { EditableText } from "@/components/editable-text";

export function TodoRow({
  teamId,
  todo,
  ownerName,
  onRename,
}: {
  teamId: string;
  todo: {
    id: string;
    title: string;
    due_date: string | null;
    completed_at: string | null;
    visibility: string;
  };
  ownerName: string;
  onRename: (next: string) => Promise<unknown>;
}) {
  const [completed, setCompleted] = useState(!!todo.completed_at);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !completed;
    setCompleted(next);
    start(async () => {
      try {
        await toggleTodo(teamId, todo.id, next);
      } catch {
        setCompleted(!next);
      }
    });
  };

  const remove = () => {
    if (!confirm("Delete this to-do?")) return;
    start(async () => {
      await deleteTodo(teamId, todo.id);
    });
  };

  const overdue =
    !completed &&
    todo.due_date &&
    new Date(todo.due_date) < new Date(new Date().toDateString());

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 text-sm",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        aria-label={completed ? "Mark incomplete" : "Mark complete"}
      >
        {completed ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        ) : (
          <Circle className="w-5 h-5" />
        )}
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-1">
        <div
          className={cn(
            "flex-1 min-w-0 truncate",
            completed && "text-zinc-400 dark:text-zinc-500 line-through",
          )}
        >
          <EditableText value={todo.title} onSave={onRename} />
        </div>
        {todo.visibility === "private" && (
          <Lock className="shrink-0 w-3 h-3 text-zinc-400 dark:text-zinc-500" />
        )}
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{ownerName}</div>
      <div
        className={cn(
          "text-xs whitespace-nowrap w-24 text-right",
          overdue ? "text-red-600" : "text-zinc-500 dark:text-zinc-400",
        )}
      >
        {todo.due_date
          ? new Date(todo.due_date).toLocaleDateString()
          : "—"}
      </div>
      <button
        type="button"
        onClick={remove}
        className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 dark:text-red-400 opacity-0 group-hover:opacity-100"
        aria-label="Delete"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
