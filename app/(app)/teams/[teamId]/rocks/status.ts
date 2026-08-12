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

/** Shared pill chrome — pair with STATUS_STYLES for tint/text/ring. */
export const STATUS_PILL_BASE =
  "inline-flex items-center rounded-full px-2.5 h-[22px] text-[11px] font-extrabold ring-1 ring-inset";

// Tint / text / ring with better contrast than brand green/brown on light tint.
export const STATUS_STYLES: Record<RockStatus, string> = {
  on_track:
    "bg-[rgba(44,179,74,.10)] text-[#177a3d] ring-[rgba(44,179,74,.35)] dark:bg-[rgba(44,179,74,.15)] dark:text-hpb-green dark:ring-[rgba(44,179,74,.45)]",
  off_track:
    "bg-[rgba(240,180,41,.16)] text-[#8a5a10] ring-[rgba(240,180,41,.55)] dark:bg-[rgba(240,180,41,.24)] dark:text-status-amber dark:ring-[rgba(240,180,41,.55)]",
  done: "bg-[rgba(0,51,160,.08)] text-hpb-blue ring-[rgba(0,51,160,.30)] dark:bg-[rgba(0,51,160,.20)] dark:text-white dark:ring-[rgba(0,51,160,.40)]",
  cancelled:
    "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700",
};

/** Full-width banner tint + bottom border (detail modal). */
export const STATUS_BANNER: Record<
  RockStatus,
  { bg: string; border: string; text: string }
> = {
  on_track: {
    bg: "bg-[rgba(44,179,74,.10)] dark:bg-[rgba(44,179,74,.15)]",
    border: "border-[rgba(44,179,74,.35)]",
    text: "text-[#177a3d] dark:text-hpb-green",
  },
  off_track: {
    bg: "bg-[rgba(240,180,41,.16)] dark:bg-[rgba(240,180,41,.24)]",
    border: "border-[rgba(240,180,41,.55)]",
    text: "text-[#8a5a10] dark:text-status-amber",
  },
  done: {
    bg: "bg-[rgba(0,51,160,.08)] dark:bg-[rgba(0,51,160,.20)]",
    border: "border-[rgba(0,51,160,.30)]",
    text: "text-hpb-blue dark:text-white",
  },
  cancelled: {
    bg: "bg-zinc-50 dark:bg-zinc-900",
    border: "border-zinc-200 dark:border-zinc-700",
    text: "text-zinc-600 dark:text-zinc-400",
  },
};

export function isRockStatus(v: string): v is RockStatus {
  return (STATUSES as readonly string[]).includes(v);
}

// Solid status color for the 3px row rail and the milestone progress bar.
// Same semantics as STATUS_STYLES, but a single opaque fill.
export const STATUS_BAR: Record<RockStatus, string> = {
  on_track: "bg-hpb-green",
  off_track: "bg-status-amber",
  done: "bg-hpb-blue",
  cancelled: "bg-zinc-300 dark:bg-zinc-700",
};
