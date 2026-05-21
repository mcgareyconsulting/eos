"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
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
  count: number;
  myCount: number;
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

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => cast(-1)}
          disabled={cantSub}
          title={cantSub ? "No votes to remove" : "Remove a vote"}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus className="h-3 w-3" />
        </button>
        <div
          className={
            "min-w-[2rem] text-center text-sm font-semibold tabular-nums " +
            (optimistic.myCount > 0
              ? "text-blue-700 dark:text-blue-300"
              : "text-zinc-600 dark:text-zinc-400")
          }
          title={`Team total: ${optimistic.count} · Your votes: ${optimistic.myCount}`}
        >
          {optimistic.count}
        </div>
        <button
          type="button"
          onClick={() => cast(1)}
          disabled={cantAdd}
          title={cantAdd ? "Out of votes (3 per team)" : "Add a vote"}
          className={
            "flex h-6 w-6 items-center justify-center rounded-md border text-xs " +
            (cantAdd
              ? "border-zinc-200 dark:border-zinc-800 text-zinc-300 dark:text-zinc-700 cursor-not-allowed"
              : "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900")
          }
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {optimistic.myCount > 0 && (
        <div className="text-[10px] text-blue-700 dark:text-blue-300 tabular-nums">
          you: {optimistic.myCount}
        </div>
      )}
      {error && (
        <span className="mt-0.5 text-[10px] text-red-600 max-w-[100px] text-center">
          {error}
        </span>
      )}
    </div>
  );
}
