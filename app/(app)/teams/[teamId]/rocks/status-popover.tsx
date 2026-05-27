"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { setRockStatus } from "./actions";
import {
  STATUSES,
  STATUS_LABELS,
  STATUS_STYLES,
  type RockStatus,
  isRockStatus,
} from "./status";

export function StatusPopover({
  teamId,
  rockId,
  status,
}: {
  teamId: string;
  rockId: string;
  status: string;
}) {
  const current: RockStatus = isRockStatus(status) ? status : "on_track";
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<RockStatus>(current);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Reset draft state every time the popover opens, so a previously-cancelled
  // edit doesn't leak into the next interaction.
  useEffect(() => {
    if (open) {
      setDraftStatus(current);
      setComment("");
      setError(null);
    }
  }, [open, current]);

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

  const offTrackNeedsReason = draftStatus === "off_track" && !comment.trim();

  function save() {
    if (offTrackNeedsReason) {
      setError("Add a short reason for going off track.");
      return;
    }
    start(async () => {
      try {
        setError(null);
        await setRockStatus(
          teamId,
          rockId,
          draftStatus,
          comment.trim() || null,
        );
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
        className={cn(
          "inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-0.5 text-xs font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 hover:brightness-95 dark:hover:brightness-110 hover:ring-2",
          STATUS_STYLES[current],
        )}
      >
        <span>{STATUS_LABELS[current]}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 opacity-60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Update rock status"
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-3 text-sm"
        >
          <div className="space-y-1">
            {STATUSES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="radio"
                  name="rock-status"
                  value={s}
                  checked={draftStatus === s}
                  onChange={() => setDraftStatus(s)}
                  className="h-3.5 w-3.5"
                />
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                    STATUS_STYLES[s],
                  )}
                >
                  {STATUS_LABELS[s]}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3">
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              {draftStatus === "off_track"
                ? "Why off track? (required)"
                : "Comment (optional)"}
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="What changed?"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            />
          </div>

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
              disabled={pending || offTrackNeedsReason}
              title={
                offTrackNeedsReason
                  ? "Add a reason before going off track"
                  : undefined
              }
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
