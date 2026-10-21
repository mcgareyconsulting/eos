import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { averageRating, meetingSummary, sortMeetingsNewestFirst, toMs } from "./meeting-summary";

describe("meeting summary", () => {
  test("average rating: one decimal, invalid values ignored, null when none", () => {
    assert.equal(averageRating([8, 9, 9]), 8.7);
    assert.equal(averageRating([7, "x", Number.NaN, null]), 7);
    assert.equal(averageRating([]), null);
    assert.equal(averageRating(["8"]), null);
  });

  test("timestamps as millis or Timestamp-like", () => {
    assert.equal(toMs(5), 5);
    assert.equal(toMs({ toMillis: () => 7 }), 7);
    assert.equal(toMs(null), null);
  });

  test("completed: floored duration and agenda name", () => {
    const s = meetingSummary({
      started_at: 0,
      ended_at: 10_000,
      current_segment: "done",
      agenda_name: "Level 10",
    });
    assert.deepEqual(
      [s.live, s.durationMin, s.progressLabel],
      [false, 1, "Completed · 1 min · Level 10"],
    );
  });

  test("live with no known segment", () => {
    assert.equal(
      meetingSummary({ started_at: 0, ended_at: null, current_segment: "nonsense" }).progressLabel,
      "In progress",
    );
  });

  test("newest first", () => {
    assert.deepEqual(
      sortMeetingsNewestFirst([{ started_at: 1 }, { started_at: 3 }, { started_at: null }]).map(
        (m) => m.started_at,
      ),
      [3, 1, null],
    );
  });
});
