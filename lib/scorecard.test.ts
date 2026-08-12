import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  average,
  formatGoal,
  hitRate,
  missingCount,
  onTrack,
  parseWeekRange,
  trendStatus,
} from "./scorecard";
import { formatWeekRange } from "./dates";

describe("onTrack", () => {
  it("handles gte / lte / eq and nulls", () => {
    assert.equal(onTrack(5, 5, "gte"), true);
    assert.equal(onTrack(4, 5, "gte"), false);
    assert.equal(onTrack(5, 5, "lte"), true);
    assert.equal(onTrack(6, 5, "lte"), false);
    assert.equal(onTrack(5, 5, "eq"), true);
    assert.equal(onTrack(null, 5, "gte"), null);
    assert.equal(onTrack(5, null, "gte"), null);
  });
});

describe("average", () => {
  it("ignores empty weeks", () => {
    assert.equal(average([1, null, 3]), 2);
    assert.equal(average([null, null]), null);
  });
});

describe("trendStatus", () => {
  it("uses the 3 most recently populated scores", () => {
    // newest first
    assert.equal(trendStatus([10, 10, 10, 10], 5, "gte"), "ok");
    assert.equal(trendStatus([1, 1, 1, 1], 5, "gte"), "off");
    // 2 of 3 off among last populated → off (majority)
    assert.equal(trendStatus([1, 1, 10, 10], 5, "gte"), "off");
    // 1 of 3 off → at-risk (watch)
    assert.equal(trendStatus([1, 10, 10], 5, "gte"), "watch");
    // empty weeks skipped when gathering populated lookback
    assert.equal(trendStatus([null, 10, null, 10, 10], 5, "gte"), "ok");
    assert.equal(trendStatus([null, null], 5, "gte"), "empty");
  });

  it("does not claim on-track when there is no goal", () => {
    // A goalless metric can't be judged: it used to report "ok" while
    // hitRate reported 0 hits, which read as a contradiction in the UI.
    assert.equal(trendStatus([10, 10, 10], null, "gte"), "nogoal");
    // No scores at all still outranks no goal — "No data" is the bigger gap.
    assert.equal(trendStatus([null, null], null, "gte"), "empty");
  });
});

describe("formatGoal", () => {
  it("uses ascii comparators for familiarity", () => {
    assert.equal(formatGoal(5, "gte", "number"), ">= 5");
    assert.equal(formatGoal(63, "lte", "number"), "<= 63");
  });
});

describe("parseWeekRange", () => {
  it("defaults to 13 and accepts 8/13/26", () => {
    assert.equal(parseWeekRange(undefined), 13);
    assert.equal(parseWeekRange("8"), 8);
    assert.equal(parseWeekRange("26"), 26);
    assert.equal(parseWeekRange("99"), 13);
  });
});

describe("formatWeekRange", () => {
  it("renders Mon–Sun range labels", () => {
    // 2026-07-27 is a Monday
    assert.equal(formatWeekRange("2026-07-27"), "Jul 27 – Aug 2");
    // Cross-month week (Mon Jun 29 → Sun Jul 5)
    assert.equal(formatWeekRange("2026-06-29"), "Jun 29 – Jul 5");
    // Same-month week
    assert.equal(formatWeekRange("2026-07-06"), "Jul 6 – 12");
  });
});

describe("hitRate", () => {
  it("handles empty values array", () => {
    const result = hitRate([], 5, "gte");
    assert.deepEqual(result, { hit: 0, recorded: 0, pct: 0, applicable: true });
  });

  it("handles all-null values", () => {
    const result = hitRate([null, null, null], 5, "gte");
    assert.deepEqual(result, { hit: 0, recorded: 0, pct: 0, applicable: true });
  });

  it("counts hits and records correctly with mixed nulls (gte)", () => {
    const result = hitRate([10, null, 5, null, 3], 5, "gte");
    // recorded: [10, 5, 3] → 3 values
    // hits: [10, 5] → 2 values >= 5
    assert.deepEqual(result, { hit: 2, recorded: 3, pct: 67, applicable: true });
  });

  it("rounds pct correctly", () => {
    // 1 hit out of 3 → 33.333... → rounds to 33
    const result = hitRate([10, 3, 3], 5, "gte");
    assert.deepEqual(result, { hit: 1, recorded: 3, pct: 33, applicable: true });
  });

  it("supports lte direction", () => {
    const result = hitRate([2, null, 5, null, 8], 5, "lte");
    // recorded: [2, 5, 8] → 3 values
    // hits: [2, 5] → 2 values <= 5
    assert.deepEqual(result, { hit: 2, recorded: 3, pct: 67, applicable: true });
  });

  it("reports not-applicable rather than 0 hits when goal is null", () => {
    const result = hitRate([10, 5, 3], null, "gte");
    // Every period misses vacuously without a goal, so `hit: 0` is not a
    // finding — `applicable: false` is what callers must render on.
    assert.deepEqual(result, {
      hit: 0,
      recorded: 3,
      pct: 0,
      applicable: false,
    });
  });
});

describe("missingCount", () => {
  it("returns 0 for empty array", () => {
    assert.equal(missingCount([]), 0);
  });

  it("returns 0 when all values present", () => {
    assert.equal(missingCount([10, 5, 3]), 0);
  });

  it("counts null entries", () => {
    assert.equal(missingCount([10, null, 5, null, 3]), 2);
  });

  it("counts all-null array", () => {
    assert.equal(missingCount([null, null, null]), 3);
  });
});
