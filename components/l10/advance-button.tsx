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
}: {
  current: Segment;
  advanceAction: () => Promise<unknown>;
  endAction: () => Promise<unknown>;
}) {
  const [pending, start] = useTransition();
  const next = nextSegment(current);

  if (current === "done") return null;

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
