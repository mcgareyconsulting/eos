"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setMetricGroup } from "./actions";

// Inline editor for a metric's section/group label. Mirrors ValueCell's
// click-to-edit pattern so section assignment feels consistent with the
// week-cell editing already on this page.
export function GroupCell({
  teamId,
  metricId,
  initial,
}: {
  teamId: string;
  metricId: string;
  initial: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial ?? "");
  const [, start] = useTransition();
  const [optimisticGroup, setOptimisticGroup] = useOptimistic(
    initial,
    (_state, next: string | null) => next,
  );

  const display = optimisticGroup ?? "No section";

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(optimisticGroup ?? "");
          setEditing(true);
        }}
        className="block text-left text-xs text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:underline"
      >
        {display}
      </button>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (optimisticGroup ?? "")) {
      setEditing(false);
      return;
    }
    const next = trimmed === "" ? null : trimmed;
    setEditing(false);
    start(async () => {
      setOptimisticGroup(next);
      await setMetricGroup(teamId, metricId, draft);
    });
  };

  return (
    <input
      autoFocus
      type="text"
      size={1}
      value={draft}
      placeholder="Section"
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
      className="w-full min-w-0 text-xs rounded bg-white dark:bg-zinc-900 px-1 py-0.5 ring-1 ring-inset ring-zinc-300 dark:ring-zinc-700 focus:outline-none focus:ring-zinc-900"
    />
  );
}
