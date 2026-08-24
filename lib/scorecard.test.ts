import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  average,
  formatGoal,
  formatScorecardDraft,
  formatValue,
  formatValueExact,
  bucketMetricsByGroup,
  hitRate,
  missingCount,
  onTrack,
  parseScorecardValue,
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

  it("uses the unit for yes/no and time goals", () => {
    assert.equal(formatGoal(1, "eq", "yesno"), "= Yes");
    assert.equal(formatGoal(90, "lte", "time"), "<= 1:30");
  });
});

describe("parseScorecardValue", () => {
  it("accepts currency, percents, commas, and blanks", () => {
    assert.deepEqual(parseScorecardValue("$10.00"), { ok: true, value: 10 });
    assert.deepEqual(parseScorecardValue("1,234"), { ok: true, value: 1234 });
    assert.deepEqual(parseScorecardValue("12.5%"), { ok: true, value: 12.5 });
    assert.deepEqual(parseScorecardValue(""), { ok: true, value: null });
    assert.deepEqual(parseScorecardValue("—"), { ok: true, value: null });
  });

  it("maps yes/no and h:mm when unit is omitted (import)", () => {
    assert.deepEqual(parseScorecardValue("yes"), { ok: true, value: 1 });
    assert.deepEqual(parseScorecardValue("No"), { ok: true, value: 0 });
    assert.deepEqual(parseScorecardValue("1:30"), { ok: true, value: 90 });
  });

  it("rejects non-numeric text instead of collapsing to NaN", () => {
    assert.deepEqual(parseScorecardValue("asdf"), {
      ok: false,
      error: "Enter a number",
    });
    assert.deepEqual(parseScorecardValue("10.0.0"), {
      ok: false,
      error: "Enter a number",
    });
  });

  it("honors the metric unit", () => {
    assert.deepEqual(parseScorecardValue("yes", "yesno"), {
      ok: true,
      value: 1,
    });
    assert.deepEqual(parseScorecardValue("false", "yesno"), {
      ok: true,
      value: 0,
    });
    assert.deepEqual(parseScorecardValue("yes", "number"), {
      ok: false,
      error: "Enter a number",
    });
    assert.deepEqual(parseScorecardValue("$10.00", "currency"), {
      ok: true,
      value: 10,
    });
    assert.deepEqual(parseScorecardValue("1:30", "time"), {
      ok: true,
      value: 90,
    });
    assert.deepEqual(parseScorecardValue("yes", "time"), {
      ok: false,
      error: "Enter time as h:mm",
    });
    assert.deepEqual(parseScorecardValue("$10.00", "yesno"), {
      ok: false,
      error: "Enter Yes or No",
    });
  });
});

describe("formatValue / formatScorecardDraft", () => {
  it("renders yes/no and time in the unit's language", () => {
    assert.equal(formatValue(1, "yesno"), "Yes");
    assert.equal(formatValue(0, "yesno"), "No");
    assert.equal(formatValue(0.67, "yesno"), "67%");
    assert.equal(formatValue(90, "time"), "1:30");
    assert.equal(formatScorecardDraft(1, "yesno"), "Yes");
    assert.equal(formatScorecardDraft(90, "time"), "1:30");
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

// N43: full-precision millions overflowed the fixed-width scorecard cells and
// pushed the whole grid into a horizontal scroll.
describe("formatValue — large numbers (N43)", () => {
  it("abbreviates currency and counts at or above 100k", () => {
    assert.equal(formatValue(2_300_000, "currency"), "$2.3M");
    assert.equal(formatValue(100_000, "currency"), "$100K");
    assert.equal(formatValue(2_300_000, "number"), "2.3M");
  });

  it("leaves anything that already fits alone", () => {
    assert.equal(formatValue(99_999, "currency"), "$99,999");
    assert.equal(formatValue(1_250, "number"), "1,250");
    assert.equal(formatValue(63, "number"), "63");
  });

  it("abbreviates negatives by magnitude, not by sign", () => {
    assert.equal(formatValue(-2_300_000, "currency"), "$-2.3M");
    assert.equal(formatValue(-99_999, "number"), "-99,999");
  });

  it("never abbreviates percent, yes/no or time", () => {
    // A four-figure percent is a data problem; "1.2K%" would read as a bug.
    assert.equal(formatValue(150_000, "percent"), "150,000%");
    assert.equal(formatValue(1, "yesno"), "Yes");
    assert.equal(formatValue(200_000, "time"), "3333:20");
  });

  it("goals inherit the abbreviation", () => {
    assert.equal(formatGoal(2_300_000, "gte", "currency"), ">= $2.3M");
  });
});

describe("formatValueExact", () => {
  it("keeps every digit, for the tooltip beside an abbreviated cell", () => {
    assert.equal(formatValueExact(2_300_000, "currency"), "$2,300,000");
    assert.equal(formatValueExact(2_300_000, "number"), "2,300,000");
  });

  it("matches formatValue for units that never abbreviate", () => {
    for (const [v, u] of [
      [150_000, "percent"],
      [1, "yesno"],
      [200_000, "time"],
      [63, "number"],
    ] as const) {
      assert.equal(formatValueExact(v, u), formatValue(v, u));
    }
  });

  it("renders an empty value the same way", () => {
    assert.equal(formatValueExact(null, "currency"), "—");
  });
});

// N40: in the L10, rows arrive pre-sorted by speaking order. Grouping must
// bucket them without reordering, so each group is its own speaking round.
describe("bucketMetricsByGroup (N40)", () => {
  const inSpeakingOrder = [
    { id: "1", group: "Weekly" },
    { id: "2", group: "Compliance" },
    { id: "3", group: "Weekly" },
    { id: "4", group: null },
    { id: "5", group: "Compliance" },
  ];

  it("keeps the incoming order inside each group", () => {
    const { groups } = bucketMetricsByGroup(inSpeakingOrder);
    const weekly = groups.find((g) => g.name === "Weekly");
    const compliance = groups.find((g) => g.name === "Compliance");
    assert.deepEqual(weekly?.items.map((m) => m.id), ["1", "3"]);
    assert.deepEqual(compliance?.items.map((m) => m.id), ["2", "5"]);
  });

  it("lists groups alphabetically and splits out ungrouped rows", () => {
    const { ungrouped, groups } = bucketMetricsByGroup(inSpeakingOrder);
    assert.deepEqual(groups.map((g) => g.name), ["Compliance", "Weekly"]);
    assert.deepEqual(ungrouped.map((m) => m.id), ["4"]);
  });

  it("treats blank and whitespace names as ungrouped", () => {
    const { ungrouped, groups } = bucketMetricsByGroup([
      { id: "a", group: "" },
      { id: "b", group: "   " },
      { id: "c", group: undefined },
    ]);
    assert.equal(groups.length, 0);
    assert.deepEqual(ungrouped.map((m) => m.id), ["a", "b", "c"]);
  });

  it("flat mode returns everything ungrouped, order intact", () => {
    const { ungrouped, groups } = bucketMetricsByGroup(inSpeakingOrder, true);
    assert.deepEqual(groups, []);
    assert.deepEqual(ungrouped.map((m) => m.id), ["1", "2", "3", "4", "5"]);
  });

  it("a team that never set a group is indistinguishable from flat", () => {
    // Field absent on the doc, which is what an ungrouped team has.
    const rows = [
      { id: "x", group: undefined },
      { id: "y", group: undefined },
    ];
    const grouped = bucketMetricsByGroup(rows);
    assert.deepEqual(grouped.ungrouped.map((m) => m.id), ["x", "y"]);
    assert.deepEqual(grouped.groups, []);
  });
});
