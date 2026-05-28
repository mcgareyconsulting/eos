"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function RatingForm({
  initialScore,
  submitAction,
}: {
  initialScore: number | null;
  submitAction: (score: number) => Promise<unknown>;
}) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [pending, start] = useTransition();

  const pick = (n: number) => {
    setScore(n);
    start(async () => { await submitAction(n); });
  };

  return (
    <div>
      <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
        How was this meeting? (1-10)
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={pending}
            onClick={() => pick(n)}
            className={cn(
              "w-9 h-9 rounded-md text-sm font-medium ring-1 ring-inset disabled:opacity-50",
              score === n
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 ring-zinc-900 dark:ring-zinc-100"
                : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {score && (
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          Your rating: {score}/10 ✓
        </div>
      )}
    </div>
  );
}
