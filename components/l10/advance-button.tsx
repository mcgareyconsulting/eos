"use client";

import { useTransition } from "react";
import { ChevronRight, Square } from "lucide-react";
import {
  type Segment,
  nextSegment,
  SEGMENT_LABELS,
} from "@/lib/l10/segments";

export function AdvanceButton({
  current,
  advanceAction,
  endAction,
  // Pass 18 #9: this drives the shared group stage (advance/end), so it's
  // leader/admin-only — same gate as the rail's Back/Next/Finish. Currently
  // unused (superseded by the rail transport, see docs/L10_GAPS.md), but
  // kept in sync so it can't reopen group transport to members if it's ever
  // wired back up. Server actions enforce this independently regardless.
  isLeader,
}: {
  current: Segment;
  advanceAction: () => Promise<unknown>;
  endAction: () => Promise<unknown>;
  isLeader: boolean;
}) {
  const [pending, start] = useTransition();
  const next = nextSegment(current);

  if (current === "done" || !isLeader) return null;

  if (current === "conclude") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await endAction(); })}
        className="inline-flex items-center gap-2 rounded-md bg-red-600 dark:bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 dark:hover:bg-red-400 disabled:opacity-50"
      >
        <Square className="w-4 h-4" />
        End meeting
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await advanceAction(); })}
      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
    >
      Next: {SEGMENT_LABELS[next]}
      <ChevronRight className="w-4 h-4" />
    </button>
  );
}
