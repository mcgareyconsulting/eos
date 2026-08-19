"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { RichText } from "@/components/rich-text";
import { cn } from "@/lib/utils";

/**
 * Collapsed body for a headline row.
 *
 * Headlines carry the story in `body`, and an imported batch can run to
 * paragraphs each — rendering every one in full turned the list into a wall of
 * text you had to scroll past to find the next title. Collapsed shows a single
 * clamped line so the row still hints at its content; the chevron matches the
 * rock row's disclosure so the two lists behave the same way.
 *
 * Renders nothing at all when there is no body, so short headlines keep their
 * one-line shape and don't grow a control that reveals nothing.
 */
export function HeadlineBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("mt-0.5", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group/body flex w-full items-start gap-1 text-left text-zinc-600 dark:text-zinc-400"
      >
        <ChevronRight
          className={cn(
            "mt-[3px] h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-hover/body:text-zinc-600 dark:group-hover/body:text-zinc-300",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <span className="sr-only">
          {open ? "Collapse headline body" : "Expand headline body"}
        </span>
        {open ? null : (
          // Preview only — the real body renders below once expanded, so the
          // markup isn't parsed twice into two competing layouts.
          <span className="line-clamp-1 min-w-0 flex-1 text-sm">{body}</span>
        )}
      </button>

      {open && (
        <RichText
          value={body}
          className="ml-[18px] mt-0.5 text-zinc-600 dark:text-zinc-400"
        />
      )}
    </div>
  );
}
