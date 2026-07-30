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

// Preferred panel height (status list + comment box + actions). Used to decide
// flip direction and to clamp max-height so Save stays on-screen.
const PANEL_MAX_H = 300;

type PanelCoords = {
  top?: number;
  bottom?: number;
  right: number;
  maxHeight: number;
};

function placePanel(trigger: DOMRect): PanelCoords {
  const gap = 4;
  const spaceBelow = window.innerHeight - trigger.bottom - gap;
  const spaceAbove = trigger.top - gap;
  const placeAbove = spaceBelow < PANEL_MAX_H && spaceAbove > spaceBelow;
  const available = Math.max(placeAbove ? spaceAbove : spaceBelow, 160);

  return {
    ...(placeAbove
      ? { bottom: window.innerHeight - trigger.top + gap }
      : { top: trigger.bottom + gap }),
    right: window.innerWidth - trigger.right,
    maxHeight: Math.min(PANEL_MAX_H, available),
  };
}

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<PanelCoords | null>(null);

  // Unique radio name per rock so multiple popovers on the page never share
  // one HTML radio group (only one panel is mounted, but keep it safe).
  const radioName = `rock-status-${rockId}`;

  // Reset draft state every time the popover opens, so a previously-cancelled
  // edit doesn't leak into the next interaction. Adjusted during render
  // (tracking the prior `open` value) rather than in an effect, so the reset
  // is visible on the same paint that shows the popover.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraftStatus(current);
      setComment("");
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

  // The panel renders `position: fixed` (anchored to the trigger's rect)
  // instead of `absolute` so it escapes ancestor overflow clipping — the
  // app shell's scrollable main pane and the L10 meeting's rock-group cards
  // both clip an in-flow `absolute` panel mid-row, cutting off the comment
  // box and Save button.
  //
  // Capture-phase scroll listeners must IGNORE scrolls inside the panel
  // (textarea overflow while typing an off-track reason). Closing on those
  // was wiping the comment mid-edit — the client-reported "can't save
  // off-track comments" bug.
  useEffect(() => {
    if (!open) return;

    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setCoords(placePanel(rect));
    };
    update();

    const onScrollOrResize = (e: Event) => {
      // Textarea (and any future overflow inside the panel) fires scroll
      // events that capture up to window — don't treat those as "page moved".
      if (
        e.type === "scroll" &&
        panelRef.current &&
        e.target instanceof Node &&
        panelRef.current.contains(e.target)
      ) {
        return;
      }
      // Reposition while the page scrolls so the panel tracks the trigger
      // instead of hard-closing mid-edit (hostile during L10 rock review).
      update();
    };

    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          // Fixed width so On Track / Off Track / Done / Cancelled line up
          // as equal pills. Label is centered; chevron is absolutely placed
          // so it doesn't shift the text.
          "relative inline-flex h-6 w-[6.75rem] items-center justify-center rounded-full px-2 text-xs font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 hover:brightness-95 hover:ring-2 dark:hover:brightness-110",
          STATUS_STYLES[current],
        )}
      >
        <span className="truncate text-center">{STATUS_LABELS[current]}</span>
        <ChevronDown
          className={cn(
            "absolute right-1.5 h-3 w-3 shrink-0 opacity-60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && coords && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Update rock status"
          style={{
            top: coords.top,
            bottom: coords.bottom,
            right: coords.right,
            maxHeight: coords.maxHeight,
          }}
          className="fixed z-40 flex w-64 flex-col overflow-y-auto rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-3 text-sm"
        >
          <div className="space-y-1">
            {STATUSES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="radio"
                  name={radioName}
                  value={s}
                  checked={draftStatus === s}
                  onChange={() => setDraftStatus(s)}
                  className="h-3.5 w-3.5"
                />
                <span
                  className={cn(
                    "inline-flex h-5 w-[5.5rem] items-center justify-center rounded-full px-2 text-center text-xs font-medium ring-1 ring-inset",
                    STATUS_STYLES[s],
                  )}
                >
                  {STATUS_LABELS[s]}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3">
            <label className="block text-xs text-zinc-600 dark:text-zinc-400 mb-1">
              {draftStatus === "off_track"
                ? "Why off track? (required)"
                : "Comment (optional)"}
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="What changed?"
              // Stop wheel/trackpad from scrolling the page under the panel
              // while the user is editing the reason.
              onWheel={(e) => e.stopPropagation()}
              className="w-full resize-y rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
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
