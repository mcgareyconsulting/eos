import { CheckCircle2 } from "lucide-react";

const STYLES: Record<string, string> = {
  on_track:
    "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800",
  off_track:
    "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800",
  done: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-700",
  cancelled:
    "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
        STYLES[status] ?? STYLES.on_track
      }`}
    >
      {status === "done" && <CheckCircle2 className="w-3 h-3" />}
      {status.replace("_", " ")}
    </span>
  );
}
