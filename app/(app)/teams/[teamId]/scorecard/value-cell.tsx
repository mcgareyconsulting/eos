"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setEntry } from "./actions";

export function ValueCell({
  teamId,
  metricId,
  weekStartDate,
  initial,
  onTrack,
}: {
  teamId: string;
  metricId: string;
  weekStartDate: string;
  initial: number | null;
  onTrack: boolean | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial == null ? "" : String(initial));
  const [, start] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    initial,
    (_state, next: number | null) => next,
  );

  const display = optimisticValue == null ? "—" : optimisticValue.toLocaleString();
  const color =
    onTrack == null
      ? "text-zinc-500 dark:text-zinc-400"
      : onTrack
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-red-700 dark:text-red-300";

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(optimisticValue == null ? "" : String(optimisticValue));
          setEditing(true);
        }}
        className={`w-full text-right rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 tabular-nums ${color}`}
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
      className="w-full min-w-0 text-right rounded bg-white dark:bg-zinc-900 px-2 py-1 tabular-nums ring-1 ring-inset ring-zinc-300 dark:ring-zinc-700 focus:outline-none focus:ring-zinc-900"
    />
  );
}
