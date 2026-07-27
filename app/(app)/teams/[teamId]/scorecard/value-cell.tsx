"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setEntry } from "./actions";
import { cn } from "@/lib/utils";

export function ValueCell({
  teamId,
  metricId,
  weekStartDate,
  initial,
  onTrack,
  isCurrentWeek = false,
}: {
  teamId: string;
  metricId: string;
  weekStartDate: string;
  initial: number | null;
  onTrack: boolean | null;
  isCurrentWeek?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial == null ? "" : String(initial));
  const [, start] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    initial,
    (_state, next: number | null) => next,
  );

  const display =
    optimisticValue == null ? "—" : optimisticValue.toLocaleString();

  // Soft cell tints match the client's existing mental model (green = hit
  // goal, red = missed) without the harsh solid fills of the legacy tool.
  const tone =
    onTrack == null
      ? isCurrentWeek
        ? "bg-sky-50/60 dark:bg-sky-950/20 text-zinc-600 dark:text-zinc-400"
        : "text-zinc-600 dark:text-zinc-400"
      : onTrack
        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300";

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(optimisticValue == null ? "" : String(optimisticValue));
          setEditing(true);
        }}
        className={cn(
          "w-full min-w-[4.5rem] rounded-md px-2 py-1.5 text-right tabular-nums hover:ring-1 hover:ring-inset hover:ring-zinc-300 dark:hover:ring-zinc-600",
          tone,
        )}
      >
        {display}
      </button>
    );
  }

  const commit = () => {
    if (draft === (optimisticValue == null ? "" : String(optimisticValue))) {
      setEditing(false);
      return;
    }
    const parsed = draft.trim() === "" ? null : Number(draft);
    const next = parsed != null && Number.isFinite(parsed) ? parsed : null;
    setEditing(false);
    start(async () => {
      setOptimisticValue(next);
      await setEntry(teamId, metricId, weekStartDate, draft);
    });
  };

  return (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      size={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
          setEditing(false);
        }
      }}
      className="w-full min-w-[4.5rem] text-right rounded-md bg-white dark:bg-zinc-900 px-2 py-1.5 tabular-nums ring-1 ring-inset ring-zinc-300 dark:ring-zinc-700 focus:outline-none focus:ring-hpb-blue dark:focus:ring-hpb-gold"
    />
  );
}
