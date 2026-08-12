"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { setEntry } from "./actions";
import {
  formatScorecardDraft,
  formatValue,
  parseScorecardValue,
} from "@/lib/scorecard";
import { cn } from "@/lib/utils";

const ERROR_CLEAR_MS = 4000;

const fieldClass =
  "w-full min-w-[4.5rem] text-right rounded-md bg-white dark:bg-zinc-900 px-2 py-1.5 tabular-nums ring-1 ring-inset ring-zinc-300 dark:ring-zinc-700 focus:outline-none focus:ring-hpb-blue dark:focus:ring-hpb-gold";

export function ValueCell({
  teamId,
  metricId,
  weekStartDate,
  initial,
  onTrack,
  unit = "number",
  isCurrentWeek = false,
}: {
  teamId: string;
  metricId: string;
  weekStartDate: string;
  initial: number | null;
  onTrack: boolean | null;
  unit?: string;
  isCurrentWeek?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatScorecardDraft(initial, unit));
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    initial,
    (_state, next: number | null) => next,
  );

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), ERROR_CLEAR_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  const display = formatValue(optimisticValue, unit);

  // Soft cell tints match the client's existing mental model (green = hit
  // goal, red = missed) without the harsh solid fills of the legacy tool.
  const tone =
    onTrack == null
      ? isCurrentWeek
        ? "bg-sky-50/60 dark:bg-sky-950/20 text-zinc-600 dark:text-zinc-400"
        : "text-zinc-600 dark:text-zinc-400"
      : onTrack
        ? // Half-strength washes: 13 tinted columns at full bg-*-50 read as
          // alarm wallpaper. The text color carries the signal; the wash is
          // only a hint.
          "bg-emerald-50/50 text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-300"
        : "bg-red-50/50 text-red-800 dark:bg-red-950/25 dark:text-red-300";

  const beginEdit = () => {
    setError(null);
    setDraft(formatScorecardDraft(optimisticValue, unit));
    setEditing(true);
  };

  const commit = (raw = draft) => {
    const previous = formatScorecardDraft(optimisticValue, unit);
    if (raw === previous) {
      setError(null);
      setEditing(false);
      return;
    }
    const parsed = parseScorecardValue(raw, unit);
    if (!parsed.ok) {
      setError(parsed.error);
      setDraft(previous);
      setEditing(false);
      return;
    }
    setError(null);
    setEditing(false);
    start(async () => {
      setOptimisticValue(parsed.value);
      const result = await setEntry(teamId, metricId, weekStartDate, raw);
      if (result && !result.ok) setError(result.error);
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        title={error ?? undefined}
        aria-invalid={error ? true : undefined}
        aria-label={error ? `${display}. ${error}` : undefined}
        className={cn(
          "w-full min-w-[4.5rem] rounded-md px-2 py-1.5 text-right tabular-nums hover:ring-1 hover:ring-inset hover:ring-zinc-300 dark:hover:ring-zinc-600",
          tone,
          error &&
            "ring-1 ring-inset ring-red-400 hover:ring-red-400 dark:ring-red-500",
        )}
      >
        <span className="block">{display}</span>
        {error ? (
          <span
            role="status"
            className="block text-[10px] font-medium leading-tight text-red-600 dark:text-red-400"
          >
            {error}
          </span>
        ) : null}
      </button>
    );
  }

  if (unit === "yesno") {
    return (
      <select
        autoFocus
        value={draft}
        aria-label="Yes or No"
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          commit(next);
        }}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setError(null);
            setEditing(false);
          }
        }}
        className={fieldClass}
      >
        <option value="">—</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      inputMode={unit === "time" ? "text" : "decimal"}
      autoComplete="off"
      size={1}
      value={draft}
      placeholder={unit === "time" ? "h:mm" : undefined}
      aria-invalid={error ? true : undefined}
      onChange={(e) => {
        setError(null);
        setDraft(e.target.value);
      }}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
          setError(null);
          setEditing(false);
        }
      }}
      className={fieldClass}
    />
  );
}
