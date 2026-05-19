"use client";

import { useTransition } from "react";
import { setIssuePriority } from "./actions";
import { cn } from "@/lib/utils";

const COLORS: Record<number, string> = {
  5: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 ring-red-200",
  4: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200",
  3: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-zinc-200",
  2: "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 ring-zinc-200",
  1: "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 ring-zinc-200",
};

export function PrioritySelect({
  teamId,
  issueId,
  priority,
}: {
  teamId: string;
  issueId: string;
  priority: number;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      value={priority}
      disabled={pending}
      onChange={(e) =>
        start(() => setIssuePriority(teamId, issueId, Number(e.target.value)))
      }
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset cursor-pointer focus:outline-none",
        COLORS[priority] ?? COLORS[3],
      )}
    >
      {[5, 4, 3, 2, 1].map((n) => (
        <option key={n} value={n}>
          P{n}
        </option>
      ))}
    </select>
  );
}
