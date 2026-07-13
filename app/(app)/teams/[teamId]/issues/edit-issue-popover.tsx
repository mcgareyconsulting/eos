"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { updateIssueMeta } from "./actions";

type Member = { user_id: string; full_name: string };

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function EditIssuePopover({
  teamId,
  issueId,
  members,
  ownerId,
  priority,
  description,
}: {
  teamId: string;
  issueId: string;
  members: Member[];
  ownerId: string | null;
  priority: string | null;
  description: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draftOwnerId, setDraftOwnerId] = useState(ownerId ?? "");
  const [draftPriority, setDraftPriority] = useState(priority ?? "");
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Reset draft state every time the popover opens, so a previously-cancelled
  // edit doesn't leak into the next interaction.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraftOwnerId(ownerId ?? "");
      setDraftPriority(priority ?? "");
      setDraftDescription(description ?? "");
      setError(null);
    }
  }

  // Close on Esc or click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function save() {
    start(async () => {
      try {
        setError(null);
        const fd = new FormData();
        fd.set("owner_id", draftOwnerId);
        fd.set("priority", draftPriority);
        fd.set("description", draftDescription);
        await updateIssueMeta(teamId, issueId, fd);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Edit owner, priority & description"
        className="rounded p-1 text-zinc-300 dark:text-zinc-600 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Edit issue"
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-3 text-sm"
        >
          <label className="block mb-2">
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Owner
            </span>
            <select
              value={draftOwnerId}
              onChange={(e) => setDraftOwnerId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block mb-2">
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Priority
            </span>
            <select
              value={draftPriority}
              onChange={(e) => setDraftPriority(e.target.value)}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
            >
              <option value="">No priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Description
            </span>
            <textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={3}
              placeholder="Optional detail"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            />
          </label>

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
