import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { explainDifferences, summarizeCauses, type Point } from "./scorecard-diff";

const series = (start: string, values: (number | null)[], updatedAt = 0): Map<string, Point> => {
  const m = new Map<string, Point>();
  const d = new Date(`${start}T00:00:00Z`);
  for (const v of values) {
    m.set(d.toISOString().slice(0, 10), { value: v, updatedAt });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return m;
};

describe("explainDifferences", () => {
  test("identical → agree", () => {
    const r = explainDifferences(series("2026-09-07", [1, 2, 3]), series("2026-09-07", [1, 2, 3]));
    assert.equal(r.verdict, "agree");
  });

  test("copy stops getting numbers → stale copy, diverging from that week", () => {
    const r = explainDifferences(series("2026-09-07", [1, 2, 3, 4, 5]), series("2026-09-07", [1, 2, 3, null, null]));
    assert.equal(r.verdict, "stale-copy");
    assert.equal(r.divergesFrom, "2026-09-28");
    assert.equal(r.lastCopy, "2026-09-21");
    assert.equal(summarizeCauses(r.diffs), "2 blank on the copy");
  });

  test("copy repeats last week's number while the original moves → carried forward", () => {
    const r = explainDifferences(series("2026-09-07", [10, 12, 15]), series("2026-09-07", [10, 12, 12]));
    assert.equal(r.verdict, "stale-copy");
    assert.equal(r.diffs[0].cause, "carried-forward");
  });

  test("the original is the one that stopped → stale original", () => {
    const r = explainDifferences(series("2026-09-07", [1, 2, null]), series("2026-09-07", [1, 2, 3]));
    assert.equal(r.verdict, "stale-original");
  });

  test("numbers entered a week late → shifted", () => {
    const r = explainDifferences(series("2026-09-07", [5, 8, 13, 21]), series("2026-09-07", [5, 3, 8, 21]));
    assert.equal(r.diffs.find((d) => d.week === "2026-09-21")?.cause, "off-by-one-period");
  });

  test("different numbers nothing explains → conflict", () => {
    const r = explainDifferences(series("2026-09-07", [1, 2, 3]), series("2026-09-07", [1, 7, 3]));
    assert.equal(r.verdict, "conflict");
  });

  test("a value written well after the rest → edited later", () => {
    const copy = series("2026-09-07", [1, 9, 3], 1_000);
    copy.set("2026-09-14", { value: 9, updatedAt: 1_000 + 60 * 60 * 1000 });
    const r = explainDifferences(series("2026-09-07", [1, 2, 3], 1_000), copy);
    assert.equal(r.diffs[0].cause, "edited-later");
    assert.equal(r.diffs[0].side, "copy");
  });

  test("only the span both were alive for is compared", () => {
    const r = explainDifferences(series("2026-08-03", [9, 9, 9, 1, 2]), series("2026-08-24", [1, 2]));
    assert.equal(r.verdict, "agree");
  });
});
