import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildScorecardColumns,
  normalizeMetricInterval,
  oldestPeriodStart,
  parseScorecardPeriod,
  periodStartFor,
} from "./scorecard-periods";

describe("parseScorecardPeriod / normalizeMetricInterval", () => {
  it("accepts known intervals and defaults to weekly", () => {
    assert.equal(parseScorecardPeriod("monthly"), "monthly");
    assert.equal(parseScorecardPeriod("quarterly"), "quarterly");
    assert.equal(parseScorecardPeriod("annual"), "annual");
    assert.equal(parseScorecardPeriod(undefined), "weekly");
    assert.equal(normalizeMetricInterval(null), "weekly");
    assert.equal(normalizeMetricInterval("bogus"), "weekly");
  });
});

describe("periodStartFor", () => {
  const d = new Date(2026, 7, 3); // Aug 3, 2026
  it("anchors each interval to its period start", () => {
    // 2026-08-03 is a Monday
    assert.equal(periodStartFor("weekly", d), "2026-08-03");
    assert.equal(periodStartFor("monthly", d), "2026-08-01");
    assert.equal(periodStartFor("quarterly", d), "2026-07-01"); // Q3
    assert.equal(periodStartFor("annual", d), "2026-01-01");
  });
});

describe("buildScorecardColumns", () => {
  const from = new Date(2026, 7, 3);

  it("builds editable weekly columns for the range", () => {
    const cols = buildScorecardColumns("weekly", undefined, 8, from);
    assert.equal(cols.length, 8);
    assert.ok(cols.every((c) => c.editable && c.weekStarts.length === 1));
    assert.equal(cols[0]!.id, "2026-08-03");
    assert.equal(cols[0]!.isCurrent, true);
  });

  it("builds monthly columns as 1sts of months, not week rollups", () => {
    const cols = buildScorecardColumns("monthly", undefined, 13, from);
    assert.equal(cols.length, 12);
    assert.equal(cols[0]!.id, "2026-08-01");
    assert.equal(cols[1]!.id, "2026-07-01");
    assert.ok(cols.every((c) => c.editable));
    assert.ok(cols.every((c) => c.weekStarts[0] === c.id));
  });

  it("builds quarterly and annual period starts", () => {
    const q = buildScorecardColumns("quarterly", undefined, 13, from);
    assert.equal(q.length, 8);
    assert.equal(q[0]!.id, "2026-07-01");
    assert.match(q[0]!.label, /^Q3 2026$/);
    const a = buildScorecardColumns("annual", undefined, 13, from);
    assert.equal(a.length, 5);
    assert.equal(a[0]!.id, "2026-01-01");
    assert.equal(a[0]!.label, "2026");
  });
});

describe("oldestPeriodStart", () => {
  it("matches the last column id", () => {
    const from = new Date(2026, 7, 3);
    const cols = buildScorecardColumns("monthly", undefined, 13, from);
    assert.equal(oldestPeriodStart("monthly", 13, from), cols[cols.length - 1]!.id);
  });
});
