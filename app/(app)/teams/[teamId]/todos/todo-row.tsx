"use client";

import { useOptimistic, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { commentDraftKey, hasCommentDraft } from "@/lib/comment-drafts";
import { toggleTodo } from "./actions";

export function TodoCheckbox({
  teamId,
  todoId,
  completed,
  appearance = "default",
  guardDraft = false,
}: {
  teamId: string;
  todoId: string;
  completed: boolean;
  /** milestone = green 16px square with white check (rocks checklist). */
  appearance?: "default" | "milestone";
  /** Ticking moves this row to another list or hides it (milestones), so
   *  ask before discarding a comment typed in its expansion. */
  guardDraft?: boolean;
}) {
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    completed,
    (_state, next: boolean) => next,
  );

  function onToggle() {
    if (
      guardDraft &&
      hasCommentDraft(commentDraftKey("todo", todoId)) &&
      !window.confirm(
        "You have a comment that hasn't been posted. Ticking this closes it and discards the comment. Tick anyway?",
      )
    )
      return;
    const next = !optimistic;
    start(async () => {
      setOptimistic(next);
      await toggleTodo(teamId, todoId, completed);
    });
  }

  if (appearance === "milestone") {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={optimistic}
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] transition-colors",
          optimistic
            ? "bg-hpb-green text-white"
            : "border border-zinc-300 bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0)] dark:border-zinc-600 dark:bg-zinc-900",
        )}
      >
        {optimistic ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </button>
    );
  }

  return (
    <input
      type="checkbox"
      checked={optimistic}
      onChange={onToggle}
      className="h-4 w-4 cursor-pointer rounded border-zinc-300 dark:border-zinc-700"
    />
  );
}
