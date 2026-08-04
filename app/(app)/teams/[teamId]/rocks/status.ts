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
    "bg-hpb-green/10 dark:bg-hpb-green/15 text-hpb-green dark:text-hpb-green ring-hpb-green/30",
  off_track:
    "bg-hpb-gold/15 dark:bg-hpb-gold/20 text-hpb-brown dark:text-hpb-gold ring-hpb-gold/40",
  done: "bg-hpb-blue/10 dark:bg-hpb-blue/20 text-hpb-blue dark:text-white ring-hpb-blue/30",
  cancelled:
    "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
};

export function isRockStatus(v: string): v is RockStatus {
  return (STATUSES as readonly string[]).includes(v);
}

// Solid status color for the 3px row rail and the milestone progress bar.
// Same semantics as STATUS_STYLES, but a single opaque fill.
export const STATUS_BAR: Record<RockStatus, string> = {
  on_track: "bg-hpb-green",
  off_track: "bg-hpb-gold",
  done: "bg-hpb-blue",
  cancelled: "bg-zinc-300 dark:bg-zinc-700",
};
