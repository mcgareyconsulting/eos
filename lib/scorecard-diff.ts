// Why do two copies of the same measurable disagree? ninety exported a
// shared measurable once per team, and a copy that stopped being kept up to
// date disagrees with the original in recognizable ways. This sorts each
// differing period into a cause, so "3 weeks differ" can be read as "one copy
// stopped being updated" rather than eyeballed.
//
// Periods are compared in order of their dates, not by a fixed 7 days, so
// monthly and quarterly measurables work the same as weekly ones.

export type Point = {
  value: number | null;
  /** When the value was last written (ms). Used to spot later edits. */
  updatedAt?: number | null;
};

export type Side = "original" | "copy";

export type Cause =
  /** One side has no number for a period the other filled. */
  | "blank"
  /** One side repeats its previous period's number while the other moved. */
  | "carried-forward"
  /** One side's number is the other's for the period before or after. */
  | "off-by-one-period"
  /** One side was written well after the rest of its values (an edit). */
  | "edited-later"
  | "unexplained";

export type PeriodDiff = {
  week: string;
  original: number | null;
  copy: number | null;
  cause: Cause;
  /** The side the cause points at — the one that lagged or was edited. */
  side: Side | null;
};

export type DiffExplanation = {
  diffs: PeriodDiff[];
  /** Last period with a number, per side. */
  lastOriginal: string | null;
  lastCopy: string | null;
  /** The first period that disagrees, when every period before it agrees. */
  divergesFrom: string | null;
  verdict:
    | "agree"
    | "stale-copy" // every difference is the copy not being updated
    | "stale-original" // every difference is the original not being updated
    | "shifted" // numbers entered a period early/late
    | "mixed" // all explained, but by more than one kind or side
    | "conflict"; // at least one difference nothing explains
};

/** Ten minutes past the typical write of a measurable's values = a later edit. */
const EDIT_GAP_MS = 10 * 60 * 1000;

const STALE: Cause[] = ["blank", "carried-forward"];

function lastFilled(m: Map<string, Point>): string | null {
  let last: string | null = null;
  for (const [w, p] of m) if (p.value != null && (!last || w > last)) last = w;
  return last;
}

function firstFilled(m: Map<string, Point>): string | null {
  let first: string | null = null;
  for (const [w, p] of m) if (p.value != null && (!first || w < first)) first = w;
  return first;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function explainDifferences(
  original: Map<string, Point>,
  copy: Map<string, Point>,
): DiffExplanation {
  const lastOriginal = lastFilled(original);
  const lastCopy = lastFilled(copy);
  const startO = firstFilled(original);
  const startC = firstFilled(copy);

  // Only the span both copies were alive for: a measurable created later on
  // one team has nothing to compare before that.
  const from = startO && startC ? (startO > startC ? startO : startC) : null;
  const to = lastOriginal && lastCopy ? (lastOriginal > lastCopy ? lastOriginal : lastCopy) : null;
  if (!from || !to) {
    return { diffs: [], lastOriginal, lastCopy, divergesFrom: null, verdict: "agree" };
  }

  const weeks = [...new Set([...original.keys(), ...copy.keys()])].filter((w) => w >= from && w <= to).sort();
  const at = (m: Map<string, Point>, i: number) => (i >= 0 && i < weeks.length ? (m.get(weeks[i])?.value ?? null) : null);

  const typical = {
    original: median([...original.values()].map((p) => p.updatedAt ?? NaN).filter(Number.isFinite)),
    copy: median([...copy.values()].map((p) => p.updatedAt ?? NaN).filter(Number.isFinite)),
  };
  const editedLater = (side: Side, week: string) => {
    const t = (side === "original" ? original : copy).get(week)?.updatedAt;
    const base = typical[side];
    return t != null && base != null && t - base > EDIT_GAP_MS;
  };

  const diffs: PeriodDiff[] = [];
  let agreedSoFar = true;
  let divergesFrom: string | null = null;
  weeks.forEach((week, i) => {
    const o = at(original, i);
    const c = at(copy, i);
    if (o === c) return;
    if (agreedSoFar) {
      divergesFrom = week;
      agreedSoFar = false;
    }

    let cause: Cause = "unexplained";
    let side: Side | null = null;
    if (o == null || c == null) {
      cause = "blank";
      side = o == null ? "original" : "copy";
    } else if (i > 0 && c === at(copy, i - 1) && o !== at(original, i - 1)) {
      cause = "carried-forward";
      side = "copy";
    } else if (i > 0 && o === at(original, i - 1) && c !== at(copy, i - 1)) {
      cause = "carried-forward";
      side = "original";
    } else if (c === at(original, i - 1) || c === at(original, i + 1)) {
      cause = "off-by-one-period";
      side = "copy";
    } else if (o === at(copy, i - 1) || o === at(copy, i + 1)) {
      cause = "off-by-one-period";
      side = "original";
    } else if (editedLater("copy", week) !== editedLater("original", week)) {
      cause = "edited-later";
      side = editedLater("copy", week) ? "copy" : "original";
    }
    diffs.push({ week, original: o, copy: c, cause, side });
  });

  let verdict: DiffExplanation["verdict"];
  if (diffs.length === 0) verdict = "agree";
  else if (diffs.some((d) => d.cause === "unexplained")) verdict = "conflict";
  else if (diffs.every((d) => STALE.includes(d.cause) && d.side === "copy")) verdict = "stale-copy";
  else if (diffs.every((d) => STALE.includes(d.cause) && d.side === "original")) verdict = "stale-original";
  else if (diffs.every((d) => d.cause === "off-by-one-period")) verdict = "shifted";
  else verdict = "mixed";

  return { diffs, lastOriginal, lastCopy, divergesFrom, verdict };
}

/** "3 blank on the copy, 1 carried forward on the copy" */
export function summarizeCauses(diffs: PeriodDiff[]): string {
  const counts = new Map<string, number>();
  for (const d of diffs) {
    const label = `${d.cause.replace(/-/g, " ")}${d.side ? ` on the ${d.side}` : ""}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${n} ${label}`).join(", ");
}
