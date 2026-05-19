"use client";

import { useState, useTransition } from "react";
import { setScorecardValue } from "./actions";
import { cn } from "@/lib/utils";

export function ValueCell({
  teamId,
  metricId,
  weekStart,
  initialValue,
  onTrack,
  readOnly = false,
  unit,
}: {
  teamId: string;
  metricId: string;
  weekStart: string;
  initialValue: number | null;
  onTrack: boolean | null;
  readOnly?: boolean;
  unit: string;
}) {
  const [value, setValue] = useState<string>(
    initialValue == null ? "" : String(initialValue),
  );
  const [savedValue, setSavedValue] = useState(value);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const commit = () => {
    if (value === savedValue) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await setScorecardValue(teamId, metricId, weekStart, value);
        setSavedValue(value);
      } catch {
        setValue(savedValue);
      } finally {
        setEditing(false);
      }
    });
  };

  const display = formatValue(savedValue, unit);

  const colorClass =
    savedValue === ""
      ? "text-zinc-400 dark:text-zinc-500"
      : onTrack === true
        ? "text-emerald-700"
        : onTrack === false
          ? "text-red-600"
          : "text-zinc-700 dark:text-zinc-300";

  if (readOnly) {
    return (
      <div className={cn("text-right tabular-nums text-sm py-1", colorClass)}>
        {display || "—"}
      </div>
    );
  }

  if (editing) {
    return (
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        defaultValue={value}
        onBlur={(e) => {
          setValue(e.target.value);
          // commit on next tick so state is set
          setTimeout(commit, 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setValue(savedValue);
            setEditing(false);
          }
        }}
        className="w-full text-right tabular-nums text-sm rounded-sm border border-zinc-300 dark:border-zinc-700 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-zinc-900"
        disabled={pending}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "w-full text-right tabular-nums text-sm py-1 px-1 rounded-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
        colorClass,
      )}
    >
      {display || "—"}
    </button>
  );
}

function formatValue(v: string, unit: string): string {
  if (v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  if (unit === "currency") return `$${n.toLocaleString()}`;
  if (unit === "percent") return `${n}%`;
  return n.toLocaleString();
}
