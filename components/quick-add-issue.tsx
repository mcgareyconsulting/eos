"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Plus, X } from "lucide-react";
import { addIssue } from "@/app/(app)/teams/[teamId]/issues/actions";

export function QuickAddIssue({
  teamId,
  prefill,
  meetingId,
}: {
  teamId: string;
  prefill?: string;
  /** When set, the created issue records this meeting as its source. */
  meetingId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(prefill ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Success feedback: the new issue lands on the Issues segment, which is
  // usually not the segment you dropped it from — without a beat of
  // confirmation people click Add twice and file duplicates.
  const [added, setAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set("title", trimmed);
    fd.set("type", "short");
    if (meetingId) fd.set("source_meeting_id", meetingId);
    start(async () => {
      try {
        setError(null);
        await addIssue(teamId, fd);
        setTitle(prefill ?? "");
        setOpen(false);
        setAdded(true);
        addedTimer.current = setTimeout(() => setAdded(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition " +
          (added
            ? "border-hpb-green/40 bg-hpb-green/10 text-hpb-green"
            : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800")
        }
        title="Drop a new issue into the Issues list"
      >
        {added ? (
          <>
            <Check className="h-3 w-3" />
            Added to Issues
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" />
            Drop to Issues
          </>
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setOpen(false);
            setTitle(prefill ?? "");
          }
        }}
        placeholder="New issue (one line)"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !title.trim()}
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2 py-1 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
      >
        {pending ? "…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTitle(prefill ?? "");
        }}
        className="rounded-md p-1 text-zinc-500 hover:text-zinc-600"
        aria-label="Cancel"
      >
        <X className="h-3 w-3" />
      </button>
      {error && <span className="text-[10px] text-red-600 ml-1">{error}</span>}
    </div>
  );
}
