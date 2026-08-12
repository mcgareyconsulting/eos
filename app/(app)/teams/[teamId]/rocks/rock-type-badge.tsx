"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { setRockType } from "./actions";
import {
  ROCK_KIND_OPTIONS,
  ROCK_TYPE_LABELS,
  ROCK_TYPE_STYLES,
  type RockType,
  toFormRockType,
} from "./rock-type";

// Small clickable chip showing a rock's type (company/department/individual),
// mirroring StatusPopover's click-to-open pattern but simpler — a single
// click on an option commits immediately, no draft/save step.
export function RockTypeBadge({
  teamId,
  rockId,
  rockType,
}: {
  teamId: string;
  rockId: string;
  rockType: string | null | undefined;
}) {
  const current = toFormRockType(rockType);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

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

  function choose(type: RockType) {
    setOpen(false);
    if (type === current) return;
    start(async () => {
      await setRockType(teamId, rockId, type);
    });
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 hover:brightness-95 dark:hover:brightness-110 hover:ring-2 disabled:opacity-60",
          ROCK_TYPE_STYLES[current],
        )}
      >
        {ROCK_TYPE_LABELS[current]}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Rock type"
          className="absolute left-0 top-full z-20 mt-1 w-36 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-1 text-sm"
        >
          {ROCK_KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === current}
              onClick={() => choose(opt.value)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  ROCK_TYPE_STYLES[opt.value],
                )}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
