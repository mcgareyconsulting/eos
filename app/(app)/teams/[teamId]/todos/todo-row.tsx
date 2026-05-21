"use client";

import { useOptimistic, useTransition } from "react";
import { toggleTodo } from "./actions";

export function TodoCheckbox({
  teamId,
  todoId,
  completed,
}: {
  teamId: string;
  todoId: string;
  completed: boolean;
}) {
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    completed,
    (_state, next: boolean) => next,
  );
  return (
    <input
      type="checkbox"
      checked={optimistic}
      onChange={() => {
        const next = !optimistic;
        start(async () => {
          setOptimistic(next);
          await toggleTodo(teamId, todoId, completed);
        });
      }}
      className="h-4 w-4 cursor-pointer rounded border-zinc-300 dark:border-zinc-700"
    />
  );
}
