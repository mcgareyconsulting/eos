// The presentation half of the due-date pair: Tailwind classes only.
//
// Deliberately not folded into lib/dates.ts. Nothing is duplicated across the
// two — both urgency reads here call that file's `daysUntil` rather than
// redoing the arithmetic — and keeping them apart is what lets lib/dates.ts
// stay pure date math, with no styling and no `cn`, so it can be imported and
// tested without dragging Tailwind along.

import { daysUntil } from "@/lib/dates";
import { cn } from "@/lib/utils";

// How many days ahead a due date turns amber ("coming up"). Rocks and
// milestones use the two-week default; to-dos are shorter-lived, so a two-week
// window painted most of the board amber and the colour stopped meaning
// anything — their call sites pass the one-week window instead.
export const DUE_SOON_DAYS = 14;
export const TODO_DUE_SOON_DAYS = 7;

// Urgency coloring for a due date. Completed / done items never shout.
// Soft red for overdue, HPB blue for due today, amber-brown inside the
// `soonDays` window, muted otherwise — the same tones rocks, milestones and
// to-dos all read by. Due-today is never colour alone: pair it with
// `dueDateShort` (lib/dates.ts) or `relativeDueLabel`, which read "Today".
// `timeZone` is the viewer's zone (see daysUntil); pass the one the paired
// label uses so colour and text agree on which day is today.
export function dueToneClass(
  due: string | null | undefined,
  done = false,
  from: Date = new Date(),
  soonDays: number = DUE_SOON_DAYS,
  timeZone?: string,
): string {
  if (!due || done) return "text-zinc-400 dark:text-zinc-500";
  const n = daysUntil(due, from, timeZone);
  if (n < 0) return "text-[#d63024] dark:text-red-400";
  if (n === 0) return "text-hpb-blue dark:text-blue-300";
  if (n <= soonDays) return "text-[#8a5a10] dark:text-status-amber";
  return "text-zinc-500 dark:text-zinc-400";
}

/**
 * Compact urgency chip (Home expanded milestones, modal due chips).
 * Background + text pair keyed off the same thresholds as dueToneClass.
 */
export function urgencyChipClass(
  due: string | null | undefined,
  done = false,
  from: Date = new Date(),
  soonDays: number = DUE_SOON_DAYS,
  timeZone?: string,
): string {
  const base =
    "rounded-full px-[7px] py-px text-[10px] font-bold tabular-nums";
  if (!due || done) {
    return cn(base, "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400");
  }
  const n = daysUntil(due, from, timeZone);
  if (n < 0) {
    return cn(
      base,
      "bg-[rgba(214,48,36,.09)] text-[#d63024] dark:bg-red-950/40 dark:text-red-400",
    );
  }
  if (n === 0) {
    return cn(
      base,
      "bg-hpb-blue/10 text-hpb-blue dark:bg-blue-950/40 dark:text-blue-300",
    );
  }
  if (n <= soonDays) {
    return cn(
      base,
      "bg-[rgba(240,180,41,.16)] text-[#8a5a10] dark:bg-[rgba(240,180,41,.24)] dark:text-status-amber",
    );
  }
  return cn(base, "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400");
}
