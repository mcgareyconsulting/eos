"use client";

import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-state twin of EntityViewTabs for surfaces that can't navigate —
 * the L10 segments keep the meeting URL, so Active | Archived is local
 * state instead of an `?archived=` link. Same pills, same counts.
 */
export function EntityViewToggle({
  showArchived,
  onChange,
  activeCount,
  archivedCount,
}: {
  showArchived: boolean;
  onChange: (showArchived: boolean) => void;
  activeCount: number;
  archivedCount: number;
}) {
  const selected =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900";
  const idle =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm tabular-nums text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn("min-w-[6.75rem]", !showArchived ? selected : idle)}
      >
        Active ({activeCount})
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn("min-w-[8.5rem]", showArchived ? selected : idle)}
      >
        <Archive className="h-3.5 w-3.5" />
        Archived ({archivedCount})
      </button>
    </div>
  );
}
