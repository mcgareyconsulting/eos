import { cn } from "@/lib/utils";
import { FEEDBACK_STATUS_LABELS, type FeedbackStatus } from "@/lib/feedback/types";

/** Chip tone per status — the mockup's palette, on the app's tokens. */
export const FEEDBACK_STATUS_TONE: Record<FeedbackStatus, string> = {
  new: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  building:
    "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/30 dark:bg-hpb-blue/25 dark:text-white dark:ring-hpb-blue/50",
  deployed:
    "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-800",
  completed:
    "bg-hpb-green/10 text-[#1d6b30] ring-hpb-green/35 dark:bg-hpb-green/15 dark:text-hpb-green dark:ring-hpb-green/45",
  answered:
    "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-800",
  follow_up:
    "bg-status-amber/15 text-[#7a4f0c] ring-status-amber/50 dark:bg-status-amber/20 dark:text-status-amber dark:ring-status-amber/50",
  postponed:
    "bg-hpb-brown/10 text-hpb-brown ring-hpb-brown/25 dark:bg-hpb-brown/30 dark:text-orange-200 dark:ring-hpb-brown/60",
};

export function FeedbackStatusChip({
  status,
  className,
}: {
  status: FeedbackStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset",
        FEEDBACK_STATUS_TONE[status],
        className,
      )}
    >
      {FEEDBACK_STATUS_LABELS[status]}
    </span>
  );
}
