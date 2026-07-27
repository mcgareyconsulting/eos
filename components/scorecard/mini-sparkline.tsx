import { cn } from "@/lib/utils";
import type { TrendStatus } from "@/lib/scorecard";

/** Tiny inline sparkline for the frozen metric column (newest → right). */
export function MiniSparkline({
  valuesNewestFirst,
  status = "ok",
  className,
}: {
  valuesNewestFirst: (number | null)[];
  /** Color by goal adherence, not raw slope (lower-is-better metrics). */
  status?: TrendStatus;
  className?: string;
}) {
  // Render oldest → newest left-to-right.
  const series = [...valuesNewestFirst]
    .reverse()
    .filter((v): v is number => v != null);
  if (series.length < 2) {
    return (
      <span
        className={cn(
          "inline-block h-5 w-12 text-zinc-300 dark:text-zinc-700",
          className,
        )}
        aria-hidden
      />
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const w = 48;
  const h = 18;
  const pad = 1;

  const points = series
    .map((v, i) => {
      const x = pad + (i / (series.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const tone =
    status === "off"
      ? "text-red-400 dark:text-red-400"
      : status === "watch"
        ? "text-amber-500 dark:text-amber-400"
        : status === "empty"
          ? "text-zinc-300 dark:text-zinc-600"
          : "text-emerald-500 dark:text-emerald-400";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("inline-block h-5 w-12", className)}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        className={tone}
      />
    </svg>
  );
}
