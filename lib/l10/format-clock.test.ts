import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatClock } from "./format-clock";

describe("formatClock", () => {
  test("pads seconds to two digits", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(5), "0:05");
    assert.equal(formatClock(65), "1:05");
  });

  test("lets minutes run past 60 (the meeting total is 90:00)", () => {
    assert.equal(formatClock(90 * 60), "90:00");
    assert.equal(formatClock(60 * 60 + 1), "60:01");
  });

  test("keeps the sign on over-budget segments", () => {
    // The segment countdown goes negative on purpose — the rail shows how far
    // past budget the group is rather than clamping at 0:00.
    assert.equal(formatClock(-1), "-0:01");
    assert.equal(formatClock(-80), "-1:20");
  });

  test("truncates toward zero so a partial second never rounds up", () => {
    assert.equal(formatClock(59.9), "0:59");
    assert.equal(formatClock(-59.9), "-0:59");
  });
});
