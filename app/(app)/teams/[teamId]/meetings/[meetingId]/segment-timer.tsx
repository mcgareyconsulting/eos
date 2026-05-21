"use client";

import { useEffect, useState } from "react";
import { SEGMENT_DURATION_SECONDS, type Segment } from "@/lib/l10/segments";

function format(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const s = Math.abs(seconds);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${sign}${mm}:${ss}`;
}

export function SegmentTimer({
  segment,
  startedAtMs,
}: {
  segment: Segment;
  startedAtMs: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!startedAtMs) {
    return (
      <div className="text-xs text-zinc-400 tabular-nums">—:—</div>
    );
  }

  const elapsed = Math.floor((now - startedAtMs) / 1000);
  const budget = SEGMENT_DURATION_SECONDS[segment] ?? 0;
  const remaining = budget - elapsed;
  const over = budget > 0 && remaining < 0;

  return (
    <div
      className={
        "tabular-nums text-sm font-medium " +
        (over
          ? "text-red-600 dark:text-red-400"
          : remaining < 30 && budget > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-600 dark:text-zinc-400")
      }
      title={
        budget
          ? `${format(elapsed)} elapsed · budget ${format(budget)}`
          : `${format(elapsed)} elapsed`
      }
    >
      {budget ? format(remaining) : format(elapsed)}
      {over && <span className="ml-1 text-[10px] uppercase">over</span>}
    </div>
  );
}
