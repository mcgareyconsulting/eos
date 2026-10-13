import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SCORECARD_PERIODS } from "@/lib/scorecard-periods";
import {
  DIRECTION_OPTIONS,
  PERIOD_OPTIONS,
  UNIT_OPTIONS,
  YESNO_GOAL_OPTIONS,
  metricOwnerLabel,
} from "./metric-form-options";

const values = (opts: readonly { value: string }[]) => opts.map((o) => o.value);

describe("metric form option lists", () => {
  test("periods: every scorecard period, in tab order, with its label", () => {
    assert.deepEqual(values(PERIOD_OPTIONS), [...SCORECARD_PERIODS]);
    assert.deepEqual(
      PERIOD_OPTIONS.map((o) => o.label),
      ["Weekly", "Monthly", "Quarterly", "Annual"],
    );
  });

  test("units: the values the server parses, same order as before", () => {
    assert.deepEqual(values(UNIT_OPTIONS), [
      "number",
      "currency",
      "percent",
      "yesno",
      "time",
    ]);
  });

  test("goal comparison: gte / lte / eq", () => {
    assert.deepEqual(values(DIRECTION_OPTIONS), ["gte", "lte", "eq"]);
    assert.equal(DIRECTION_OPTIONS[0].label, "At least (>=)");
  });

  test("Yes/No goal: empty string is No goal", () => {
    assert.deepEqual(values(YESNO_GOAL_OPTIONS), ["", "Yes", "No"]);
    assert.equal(YESNO_GOAL_OPTIONS[0].label, "No goal");
  });
});

describe("metricOwnerLabel", () => {
  const members = [
    { user_id: "u1", full_name: "Ada" },
    { user_id: "u2", full_name: "Bo" },
  ];

  test("no owner prompts a choice", () => {
    assert.equal(metricOwnerLabel({ ownerId: "", members }), "Choose an owner");
  });

  test("a roster member shows their name, ahead of any resolved name", () => {
    assert.equal(
      metricOwnerLabel({ ownerId: "u2", members, resolvedName: "Stale" }),
      "Bo",
    );
  });

  test("an off-roster owner uses the server-resolved name", () => {
    assert.equal(
      metricOwnerLabel({ ownerId: "x", members, resolvedName: "Cy" }),
      "Cy",
    );
  });

  test("an unrostered creator defaulting to themself reads You", () => {
    assert.equal(metricOwnerLabel({ ownerId: "me", members, selfId: "me" }), "You");
  });

  test("an unknown off-roster owner still says who will be saved", () => {
    assert.equal(
      metricOwnerLabel({ ownerId: "x", members, resolvedName: null }),
      "Current owner (not on this team)",
    );
  });
});
