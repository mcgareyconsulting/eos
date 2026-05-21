// Shared EOS Rock status constants. Used by server actions, the status popover,
// and any read-side rendering that needs label/color mapping.

export const STATUSES = ["on_track", "off_track", "done", "cancelled"] as const;
export type RockStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<RockStatus, string> = {
  on_track: "On Track",
  off_track: "Off Track",
  done: "Done",
  cancelled: "Cancelled",
};

export const STATUS_STYLES: Record<RockStatus, string> = {
  on_track:
    "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 ring-emerald-200",
  off_track:
    "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200",
  done: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-zinc-200",
  cancelled:
    "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 ring-zinc-200",
};

export function isRockStatus(v: string): v is RockStatus {
  return (STATUSES as readonly string[]).includes(v);
}
