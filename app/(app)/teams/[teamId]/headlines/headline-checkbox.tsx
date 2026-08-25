"use client";

import { useOptimistic, useTransition } from "react";
import { setHeadlineDiscussed } from "./actions";

/**
 * Optimistic checkbox for "discussed this meeting" on a headline.
 *
 * Every headline is checkable, org-wide cascades included. A cascaded message
 * is fanned out as one doc per team, so this closes the item for THIS team's
 * queue and cannot touch another team's copy or the source — which is the EOS
 * cycle the client runs (Steph, 8/19 L10): share it to your team, then mark it
 * off so it stops coming back. The read-only rule that used to disable this
 * still applies to the headline's *text* — editing and deleting a broadcast
 * copy remain blocked, in the UI and in the server action.
 */
export function HeadlineDiscussedCheckbox({
  teamId,
  headlineId,
  discussed,
}: {
  teamId: string;
  headlineId: string;
  discussed: boolean;
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
      title={
        optimistic
          ? "Discussed — will archive when the meeting ends"
          : "Mark as discussed"
      }
      aria-label={optimistic ? "Mark not discussed" : "Mark as discussed"}
      onChange={() => {
        const next = !optimistic;
        start(async () => {
          setOptimistic(next);
          await setHeadlineDiscussed(teamId, headlineId, next);
        });
      }}
      className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 dark:border-zinc-700"
    />
  );
}
