"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setMetricGroup } from "./actions";

// Inline editor for a metric's group label. Mirrors ValueCell's click-to-edit
// pattern so group assignment feels consistent with the week-cell editing
// already on this page.
//
// "Group" in the UI and `group` in the data — the same word ninety uses in
// its exports ("Group Name"), and the word the client uses out loud. It shipped
// briefly as "Section", which is why Steph asked for a feature that already
// existed (N40). The unset state reads "+ Group" rather than a grey noun,
// which looked like a status rather than something clickable.
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

  const display = optimisticGroup ?? "+ Group";

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
            ? `Group: ${optimisticGroup} — click to change`
            : "Put this measurable in a group (e.g. Weekly, Compliance)"
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
      placeholder="Group"
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
