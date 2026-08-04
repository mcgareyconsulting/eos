"use client";

import { formatValue } from "@/lib/scorecard";

type Props = {
  /** Newest first — same order as the grid's columns. */
  values: (number | null)[];
  /** Newest first, aligned with `values` (e.g. "Aug 3"). */
  labels: string[];
  goal: number | null;
  average: number | null;
  unit: string;
  /** Status accent from STATUS_TONE[...].accent. */
  accent: string;
  width?: number;
  height?: number;
};

const PAD = { left: 46, right: 16, top: 16, bottom: 58 };

/**
 * The system's Trends chart, dependency-free: Actual line with dots on
 * recorded periods only, dashed Goal, solid Average, rounded y ticks.
 *
 * Axis labels are HTML positioned over the SVG on purpose — they inherit the
 * app font and avoid `<text>` rendering quirks. Everything geometric is SVG.
 */
export function TrendChart({
  values,
  labels,
  goal,
  average,
  unit,
  accent,
  width = 1060,
  height = 230,
}: Props) {
  const n = values.length;
  if (n < 2) return null;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const nums = values.filter((v): v is number => v != null);
  const peak = Math.max(goal ?? 0, average ?? 0, ...(nums.length ? nums : [1]));

  // Round tick step → axis max (aim for 2–3 ticks like the legacy chart).
  const rawStep = Math.max(peak, 1) / 2.2;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.max(Math.ceil(rawStep / magnitude) * magnitude, 1);
  const axisMax = Math.max(Math.ceil(peak / step) * step, step);

  // Index 0 = oldest on screen, so iterate values from the end.
  const x = (i: number) => PAD.left + (i / (n - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / axisMax) * plotH;
  const bottom = PAD.top + plotH;

  const ticks: number[] = [];
  for (let v = step; v <= axisMax + 0.001; v += step) ticks.push(v);

  const points: string[] = [];
  const dots: { x: number; y: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const v = values[i];
    if (v == null) continue; // gap: break the line, never plot a zero
    const px = x(n - 1 - i);
    const py = y(v);
    points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    dots.push({ x: px, y: py });
  }

  return (
    <div>
      <div className="relative max-w-full" style={{ width }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full"
          role="img"
          aria-label="Trend versus goal"
        >
          {ticks.map((t) => (
            <line
              key={t}
              x1={PAD.left}
              y1={y(t)}
              x2={width - PAD.right}
              y2={y(t)}
              className="stroke-zinc-100 dark:stroke-zinc-800"
              strokeWidth={1}
            />
          ))}
          <line
            x1={PAD.left}
            y1={bottom}
            x2={width - PAD.right}
            y2={bottom}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeWidth={1}
          />
          {goal != null && (
            <line
              x1={PAD.left}
              y1={y(goal)}
              x2={width - PAD.right}
              y2={y(goal)}
              className="stroke-zinc-400 dark:stroke-zinc-500"
              strokeWidth={1.5}
              strokeDasharray="7 5"
            />
          )}
          {average != null && (
            <line
              x1={PAD.left}
              y1={y(average)}
              x2={width - PAD.right}
              y2={y(average)}
              className="stroke-zinc-500 dark:stroke-zinc-400"
              strokeWidth={1}
            />
          )}
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke={accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={4.5} fill={accent} />
          ))}
        </svg>

        {ticks.map((t) => (
          <div
            key={t}
            className="absolute text-right text-[11.5px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"
            style={{ left: 0, top: y(t) - 9, width: PAD.left - 8 }}
          >
            {formatValue(t, unit)}
          </div>
        ))}
        {labels.map((label, i) => {
          const px = x(n - 1 - i);
          return (
            <div
              key={label + i}
              className={
                "absolute w-[46px] whitespace-nowrap text-right text-[11px] font-semibold " +
                (i === 0
                  ? "text-hpb-blue dark:text-hpb-gold"
                  : "text-zinc-500 dark:text-zinc-400")
              }
              style={{
                left: px - 46,
                top: bottom + 7,
                transform: "rotate(-32deg)",
                transformOrigin: "100% 50%",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-center gap-6 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 4" />
          </svg>
          Goal
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="10" aria-hidden>
            <line x1="0" y1="5" x2="26" y2="5" stroke={accent} strokeWidth="2.5" />
            <circle cx="13" cy="5" r="4" fill={accent} />
          </svg>
          Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1" />
          </svg>
          Average
        </span>
      </div>
    </div>
  );
}
