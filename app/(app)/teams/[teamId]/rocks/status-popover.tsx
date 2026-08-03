"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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

// Estimate used for the first paint before the panel is measured; real height
// is re-measured after mount so the full content stays on-screen.
const PANEL_ESTIMATE_H = 400;
const PANEL_W = 320; // a bit wider for notes comfort
const VIEWPORT_PAD = 12;
const GAP = 6;

type PanelCoords = {
  top: number;
  left: number;
};

/**
 * Place the full natural-height panel so it never needs internal scroll.
 * Prefer below the trigger; flip above when there isn't room; clamp into
 * the viewport without height-capping (content sizes itself).
 */
function placePanel(trigger: DOMRect, panelH: number): PanelCoords {
  const h = panelH > 0 ? panelH : PANEL_ESTIMATE_H;
  const spaceBelow = window.innerHeight - trigger.bottom - GAP - VIEWPORT_PAD;
  const spaceAbove = trigger.top - GAP - VIEWPORT_PAD;
  const placeAbove = spaceBelow < h && spaceAbove > spaceBelow;

  let top: number;
  if (placeAbove) {
    top = trigger.top - GAP - h;
  } else {
    top = trigger.bottom + GAP;
  }

  // Keep the full panel inside the viewport vertically.
  const maxTop = window.innerHeight - VIEWPORT_PAD - h;
  top = Math.min(Math.max(top, VIEWPORT_PAD), Math.max(VIEWPORT_PAD, maxTop));

  // Prefer aligning to the right edge of the trigger (status pill sits right).
  let left = trigger.right - PANEL_W;
  left = Math.min(
    Math.max(left, VIEWPORT_PAD),
    window.innerWidth - VIEWPORT_PAD - PANEL_W,
  );

  return { top, left };
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const radioName = `rock-status-${rockId}`;

  // Reset draft on open (render-time, same paint as the panel).
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
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Portal + fixed placement. Measure real panel height after paint so all
  // statuses + notes fit without scroll; flip/clamp as a whole.
  useEffect(() => {
    if (!open) return;

    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const measured = panelRef.current?.offsetHeight ?? 0;
      setCoords(placePanel(rect, measured));
    };
    update();
    // Second pass after layout: estimate → real height may differ by a few px.
    const raf = requestAnimationFrame(update);

    const onScrollOrResize = (e: Event) => {
      if (
        e.type === "scroll" &&
        panelRef.current &&
        e.target instanceof Node &&
        panelRef.current.contains(e.target)
      ) {
        return;
      }
      update();
    };

    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, draftStatus, error]);

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

  const panel =
    open && coords && mounted
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Update rock status"
            style={{
              top: coords.top,
              left: coords.left,
              width: PANEL_W,
            }}
            className="fixed z-50 flex flex-col rounded-xl border border-zinc-300 bg-white p-4 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              {STATUSES.map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
                      "inline-flex h-6 w-[5.75rem] items-center justify-center rounded-full px-2 text-center text-xs font-medium ring-1 ring-inset",
                      STATUS_STYLES[s],
                    )}
                  >
                    {STATUS_LABELS[s]}
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {draftStatus === "off_track"
                  ? "Why off track? (required)"
                  : "Comment (optional)"}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={5}
                placeholder="What changed? Leave a note for the team…"
                onWheel={(e) => e.stopPropagation()}
                className="w-full resize-none rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            {error && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
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
      {panel}
    </div>
  );
}
