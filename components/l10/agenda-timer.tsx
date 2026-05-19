"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SEGMENT_DURATION_SECONDS,
  SEGMENT_LABELS,
  TOTAL_MEETING_SECONDS,
  type Segment,
} from "@/lib/l10/segments";
import { cn } from "@/lib/utils";

export function AgendaTimer({
  segment,
  segmentStartedAt,
  meetingStartedAt,
}: {
  segment: Segment;
  segmentStartedAt: string;
  meetingStartedAt: string;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const segStartMs = new Date(segmentStartedAt).getTime();
  const meetStartMs = new Date(meetingStartedAt).getTime();
  const segElapsedSec = Math.max(0, Math.floor((now - segStartMs) / 1000));
  const meetElapsedSec = Math.max(0, Math.floor((now - meetStartMs) / 1000));

  const targetSec = SEGMENT_DURATION_SECONDS[segment] ?? 0;
  const remainingSec = targetSec - segElapsedSec;
  const pct = targetSec > 0 ? segElapsedSec / targetSec : 0;

  const colorClass =
    pct >= 1
      ? "text-red-600 dark:text-red-400"
      : pct >= 0.8
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-700 dark:text-emerald-400";

  // Ping the router once per segment when its time runs out so any
  // server-time-dependent UI refreshes. Tracked by ref so we don't
  // re-trigger every tick while pct stays >= 1.
  const firedForSegment = useRef<string | null>(null);
  useEffect(() => {
    if (pct >= 1 && firedForSegment.current !== segmentStartedAt) {
      firedForSegment.current = segmentStartedAt;
      router.refresh();
    }
  }, [pct, router, segmentStartedAt]);

  return (
    <div className="flex items-center gap-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-3">
      <div className="flex-1">
        <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Current segment
        </div>
        <div className="text-lg font-semibold">{SEGMENT_LABELS[segment]}</div>
      </div>

      <div className="text-right">
        <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Segment
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums", colorClass)}>
          {formatClock(remainingSec)}
        </div>
        <div className="text-xs text-zinc-400 dark:text-zinc-500">
          target {formatClock(targetSec)}
        </div>
      </div>

      <div className="text-right">
        <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Total
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {formatClock(meetElapsedSec)}
        </div>
        <div className="text-xs text-zinc-400 dark:text-zinc-500">
          target {formatClock(TOTAL_MEETING_SECONDS)}
        </div>
      </div>
    </div>
  );
}

function formatClock(totalSec: number): string {
  const negative = totalSec < 0;
  const t = Math.abs(totalSec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return (negative ? "-" : "") + body;
}
