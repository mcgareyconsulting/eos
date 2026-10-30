"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** Rows an owner section shows before it offers "Show N more". */
export const OWNER_ROWS_LIMIT = 5;

/**
 * The first `limit` rows of an owner section, then one "Show N more" row
 * that reveals the rest in place ("Show less" folds them back). Chosen over
 * a scroll box (a scroller nested in a card nested in a scrolling page traps
 * the wheel) and over collapsing the section (which hides the work that is
 * due). Local state: a reload shows the first five again.
 *
 * Children are the already-keyed rows (TodoListRow / MilestoneTodoRow), so
 * ticking a row never remounts it — the same array is sliced, not regrouped.
 */
export function LimitedRows({
  children,
  limit = OWNER_ROWS_LIMIT,
  noun = "to-dos",
}: {
  children: React.ReactNode[];
  limit?: number;
  noun?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = children.length - limit;
  if (hidden <= 0) return <>{children}</>;
  return (
    <>
      {showAll ? children : children.slice(0, limit)}
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        aria-expanded={showAll}
        className="flex w-full items-center justify-center gap-1 px-3 py-1.5 text-[12px] font-semibold text-hpb-blue hover:bg-zinc-50 dark:text-hpb-gold dark:hover:bg-zinc-800/60"
      >
        {showAll ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            Show less
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            Show {hidden} more {noun}
          </>
        )}
      </button>
    </>
  );
}
