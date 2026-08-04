"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { MAX_VOTES_PER_TEAM } from "@/lib/issues";
import { castVote } from "./actions";

export function VoteButton({
  teamId,
  issueId,
  count,
  myCount,
  myRemaining,
}: {
  teamId: string;
  issueId: string;
  /** Team-wide total votes on this issue (all members). */
  count: number;
  /** How many of *your* credits are on this issue. */
  myCount: number;
  /** How many of your credits are still unspent. */
  myRemaining: number;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, applyOptimistic] = useOptimistic(
    { count, myCount, myRemaining },
    (_s, next: { count: number; myCount: number; myRemaining: number }) => next,
  );

  function cast(delta: 1 | -1) {
    if (delta === 1 && optimistic.myRemaining <= 0) return;
    if (delta === -1 && optimistic.myCount <= 0) return;
    start(async () => {
      setError(null);
      applyOptimistic({
        count: optimistic.count + delta,
        myCount: optimistic.myCount + delta,
        myRemaining: optimistic.myRemaining - delta,
      });
      try {
        await castVote(teamId, issueId, delta);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const cantAdd = optimistic.myRemaining <= 0;
  const cantSub = optimistic.myCount <= 0;
  const addTitle = cantAdd
    ? `Out of credits (${MAX_VOTES_PER_TEAM} per person). Remove a vote first.`
    : `Add one of your credits (${optimistic.myRemaining} left)`;
  const subTitle = cantSub
    ? "You have no credits on this issue"
    : "Remove one of your credits from this issue";

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => cast(-1)}
          disabled={cantSub}
          title={subTitle}
          aria-label={subTitle}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Minus className="h-3 w-3" />
        </button>
        <div
          className={
            "flex min-w-[2rem] flex-col items-center leading-none " +
            (optimistic.myCount > 0
              ? "text-blue-700 dark:text-blue-300"
              : "text-zinc-600 dark:text-zinc-400")
          }
          title={`Team total: ${optimistic.count} · Yours on this issue: ${optimistic.myCount} · Your credits left: ${optimistic.myRemaining}`}
        >
          <span className="text-sm font-semibold tabular-nums">
            {optimistic.count}
          </span>
          <span className="text-[9px] font-normal uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            team
          </span>
        </div>
        <button
          type="button"
          onClick={() => cast(1)}
          disabled={cantAdd}
          title={addTitle}
          aria-label={addTitle}
          className={
            "flex h-6 w-6 items-center justify-center rounded-md border text-xs " +
            (cantAdd
              ? "cursor-not-allowed border-zinc-300 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700"
              : "border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900")
          }
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div
        className={
          "text-[10px] tabular-nums leading-none " +
          (optimistic.myCount > 0
            ? "font-medium text-blue-700 dark:text-blue-300"
            : "text-zinc-400 dark:text-zinc-500")
        }
        title="How many of your credits are on this issue"
      >
        you: {optimistic.myCount}
      </div>
      {error && (
        <span className="mt-0.5 max-w-[100px] text-center text-[10px] text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
