"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { toggleTodo } from "../../todos/actions";

export function TodoToggle({
  teamId,
  todoId,
  completed,
}: {
  teamId: string;
  todoId: string;
  completed: boolean;
}) {
  const [done, setDone] = useState(completed);
  const [pending, start] = useTransition();
  const toggle = () => {
    const next = !done;
    setDone(next);
    start(async () => {
      try {
        await toggleTodo(teamId, todoId, next);
      } catch {
        setDone(!next);
      }
    });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
      aria-label={done ? "Mark incomplete" : "Mark complete"}
    >
      {done ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="w-5 h-5" />
      )}
    </button>
  );
}
