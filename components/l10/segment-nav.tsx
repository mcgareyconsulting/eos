"use client";

import { useTransition } from "react";
import { Check, Circle, CircleDot } from "lucide-react";
import {
  SEGMENTS,
  SEGMENT_LABELS,
  SEGMENT_DURATION_SECONDS,
  type Segment,
} from "@/lib/l10/segments";
import { cn } from "@/lib/utils";

type Props = {
  current: Segment;
  setSegmentAction: (segment: Segment) => Promise<unknown>;
};

export function SegmentNav({ current, setSegmentAction }: Props) {
  const [pending, start] = useTransition();
  const currentIdx = SEGMENTS.indexOf(current);

  return (
    <nav className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 space-y-0.5">
      {SEGMENTS.filter((s) => s !== "done").map((s, idx) => {
        const isCurrent = s === current;
        const isPast = idx < currentIdx;
        const targetMin = Math.round(SEGMENT_DURATION_SECONDS[s] / 60);
        return (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await setSegmentAction(s); })}
            className={cn(
              "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
              isCurrent
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : isPast
                  ? "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              pending && "opacity-50",
            )}
          >
            {isPast ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : isCurrent ? (
              <CircleDot className="w-4 h-4 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 shrink-0" />
            )}
            <span className="flex-1">{SEGMENT_LABELS[s]}</span>
            <span
              className={cn(
                "text-xs tabular-nums",
                isCurrent
                  ? "text-zinc-300 dark:text-zinc-600"
                  : "text-zinc-400 dark:text-zinc-500",
              )}
            >
              {targetMin}m
            </span>
          </button>
        );
      })}
    </nav>
  );
}
