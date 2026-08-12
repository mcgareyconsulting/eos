import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Keep in step with rocks/status.ts STATUS_STYLES (Home + generic badges).
const STYLES: Record<string, string> = {
  on_track:
    "bg-[rgba(44,179,74,.10)] text-[#177a3d] ring-[rgba(44,179,74,.35)] dark:bg-[rgba(44,179,74,.15)] dark:text-hpb-green dark:ring-[rgba(44,179,74,.45)]",
  off_track:
    "bg-[rgba(240,180,41,.16)] text-[#8a5a10] ring-[rgba(240,180,41,.55)] dark:bg-[rgba(240,180,41,.24)] dark:text-status-amber dark:ring-[rgba(240,180,41,.55)]",
  done: "bg-[rgba(0,51,160,.08)] text-hpb-blue ring-[rgba(0,51,160,.30)] dark:bg-[rgba(0,51,160,.20)] dark:text-white dark:ring-[rgba(0,51,160,.40)]",
  cancelled:
    "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700",
};

const LABELS: Record<string, string> = {
  on_track: "On Track",
  off_track: "Off Track",
  done: "Done",
  cancelled: "Cancelled",
};

export function StatusBadge({
  status,
  compact,
}: {
  status: string;
  /** Home table / dense rows */
  compact?: boolean;
}) {
  const label =
    LABELS[status] ??
    status
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-extrabold ring-1 ring-inset",
        compact
          ? "px-2.5 py-px text-[10.5px]"
          : "h-[22px] px-2.5 text-[11px]",
        STYLES[status] ?? STYLES.on_track,
      )}
    >
      {status === "done" && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );
}
