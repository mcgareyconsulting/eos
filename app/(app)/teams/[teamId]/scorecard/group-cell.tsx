"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setMetricGroup } from "./actions";

// Inline editor for a metric's category label. Mirrors ValueCell's
// click-to-edit pattern so category assignment feels consistent with the
// week-cell editing already on this page.
//
// Called "Category" in the UI, `group` in the data — ninety calls it
// "Group Name" in its exports and the client calls it a category (N40:
// Steph asked for a feature that already existed because it was labelled
// "Section"). The unset state reads "+ Category" rather than "No section",
// because a grey noun looked like a status rather than something clickable.
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

  const display = optimisticGroup ?? "+ Category";

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(optimisticGroup ?? "");
          setEditing(true);
        }}
        title={
          optimisticGroup
            ? `Category: ${optimisticGroup} — click to change`
            : "Group this measurable under a category (e.g. Weekly, Compliance)"
        }
        className={
          "block text-left text-xs hover:underline " +
          (optimisticGroup
            ? "text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            : "text-hpb-blue/70 dark:text-hpb-gold/70 hover:text-hpb-blue dark:hover:text-hpb-gold")
        }
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
      placeholder="Category"
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
