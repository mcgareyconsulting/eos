"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function RatingForm({
  initialScore,
  initialNotes,
  submitAction,
}: {
  initialScore: number | null;
  initialNotes?: string;
  submitAction: (score: number, notes: string) => Promise<unknown>;
}) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (score == null) return;
    start(async () => {
      try {
        setError(null);
        await submitAction(score, notes);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save rating.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
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
              onClick={() => setScore(n)}
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
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes (optional) — why that rating?"
        className="block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || score == null}
          className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : initialScore != null ? "Update rating" : "Submit rating"}
        </button>
        {saved && (
          <span className="text-xs text-hpb-green">Saved ✓</span>
        )}
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    </form>
  );
}
