import { daysUntil } from "@/lib/dates";
import { cn } from "@/lib/utils";

// Urgency coloring for a due date. Completed / done items never shout.
// Soft red for overdue, amber-brown inside two weeks, muted otherwise —
// the same three tones rocks, milestones and to-dos all read by.
export function dueToneClass(
  due: string | null | undefined,
  done = false,
  from: Date = new Date(),
): string {
  if (!due || done) return "text-zinc-400 dark:text-zinc-500";
  const n = daysUntil(due, from);
  if (n < 0) return "text-[#d63024] dark:text-red-400";
  if (n <= 14) return "text-[#8a5a10] dark:text-status-amber";
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
): string {
  const base =
    "rounded-full px-[7px] py-px text-[10px] font-bold tabular-nums";
  if (!due || done) {
    return cn(base, "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400");
  }
  const n = daysUntil(due, from);
  if (n < 0) {
    return cn(
      base,
      "bg-[rgba(214,48,36,.09)] text-[#d63024] dark:bg-red-950/40 dark:text-red-400",
    );
  }
  if (n <= 14) {
    return cn(
      base,
      "bg-[rgba(240,180,41,.16)] text-[#8a5a10] dark:bg-[rgba(240,180,41,.24)] dark:text-status-amber",
    );
  }
  return cn(base, "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400");
}
