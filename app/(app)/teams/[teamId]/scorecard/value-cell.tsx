"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { setEntry } from "./actions";
import {
  formatScorecardDraft,
  formatValue,
  formatValueExact,
  parseScorecardValue,
} from "@/lib/scorecard";
import { cn } from "@/lib/utils";

// A rejected *value* (bad input) is self-explanatory once the cell reverts, so
// it clears itself. A failed *save* must not: the number is not in Firestore,
// and a message that disappears after four seconds leaves a cell that looks
// saved and isn't. Only the first kind is on a timer.
const ERROR_CLEAR_MS = 4000;

type CellError = { message: string; sticky: boolean };

/**
 * Why a save failed, in the user's terms.
 *
 * setEntry() only *returns* `{ ok: false }` for a bad parse — every other
 * failure throws: a Firestore error, a dropped connection, or a Server Action
 * ID the running revision doesn't recognise (the deploy-skew case that
 * next.config.ts `deploymentId` now guards). Those used to escape the
 * transition and take the whole Scorecard down through app/(app)/error.tsx,
 * losing whatever had just been typed. Now they stay in the cell.
 */
function saveErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  // Next's own wording for an action the current build no longer serves.
  if (/Server Action/i.test(text)) {
    return "App was updated — reload the page, then re-enter this.";
  }
  return "Not saved — check your connection and try again.";
}

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
  const [error, setError] = useState<CellError | null>(null);
  // What was typed when a save failed. Reopening the cell restores it rather
  // than the stale stored value, so a retry is a click, not a re-type.
  const [unsavedDraft, setUnsavedDraft] = useState<string | null>(null);
  const [, start] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    initial,
    (_state, next: number | null) => next,
  );

  useEffect(() => {
    if (!error || error.sticky) return;
    const t = window.setTimeout(() => setError(null), ERROR_CLEAR_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  const display = formatValue(optimisticValue, unit);
  // Large values abbreviate ($2.3M) so the cell keeps its width — the precise
  // figure stays one hover away, and editing always works on the raw number.
  const exact = formatValueExact(optimisticValue, unit);
  const abbreviated = exact !== display;

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
    setDraft(unsavedDraft ?? formatScorecardDraft(optimisticValue, unit));
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
      setError({ message: parsed.error, sticky: false });
      setDraft(previous);
      setEditing(false);
      return;
    }
    setError(null);
    setEditing(false);
    start(async () => {
      setOptimisticValue(parsed.value);
      try {
        const result = await setEntry(teamId, metricId, weekStartDate, raw);
        if (result && !result.ok) {
          setError({ message: result.error, sticky: false });
          return;
        }
        setUnsavedDraft(null);
      } catch (err) {
        // redirect() (expired session -> /login) and notFound() (the measurable
        // was deleted under us) are Next internals that must reach the router,
        // not be swallowed as a cell error.
        unstable_rethrow(err);
        setUnsavedDraft(raw);
        setError({ message: saveErrorMessage(err), sticky: true });
      }
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        title={error?.message ?? (abbreviated ? exact : undefined)}
        aria-invalid={error ? true : undefined}
        aria-label={
          error
            ? `${exact}. ${error.message}`
            : abbreviated
              ? exact
              : undefined
        }
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
            {error.message}
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
