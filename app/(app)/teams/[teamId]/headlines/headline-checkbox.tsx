"use client";

import { useOptimistic, useTransition } from "react";
import { setHeadlineDiscussed } from "./actions";

/** Optimistic checkbox for "discussed this meeting" on a headline. */
export function HeadlineDiscussedCheckbox({
  teamId,
  headlineId,
  discussed,
  disabled = false,
}: {
  teamId: string;
  headlineId: string;
  discussed: boolean;
  disabled?: boolean;
}) {
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    discussed,
    (_state, next: boolean) => next,
  );

  return (
    <input
      type="checkbox"
      checked={optimistic}
      disabled={disabled}
      title={
        disabled
          ? "Org-wide headlines can't be marked here"
          : optimistic
            ? "Discussed — will archive when the meeting ends"
            : "Mark as discussed"
      }
      aria-label={optimistic ? "Mark not discussed" : "Mark as discussed"}
      onChange={() => {
        if (disabled) return;
        const next = !optimistic;
        start(async () => {
          setOptimistic(next);
          await setHeadlineDiscussed(teamId, headlineId, next);
        });
      }}
      className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
    />
  );
}
