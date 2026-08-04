import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENTS,
  SEGMENT_DURATION_SECONDS,
  SEGMENT_HINTS,
  SEGMENT_LABELS,
  TOTAL_MEETING_SECONDS,
  nextSegment,
  prevSegment,
  isSegment,
  normalizeSegment,
} from "./segments";
// normalizeSegment imported below with other helpers if needed

// This file is the single source of truth every L10 UI piece trusts (segment
// order, timing, labels). These tests exist to catch the two mistakes most
// likely when reordering/adding/resizing segments: breaking a boundary
// clamp, or letting the per-segment durations drift from the advertised
// meeting total.

describe("nextSegment / prevSegment", () => {
  test("steps forward through the normal sequence", () => {
    assert.equal(nextSegment("segue"), "scorecard");
    assert.equal(nextSegment("scorecard"), "rocks");
  });

  test("steps backward through the normal sequence", () => {
    assert.equal(prevSegment("rocks"), "scorecard");
    assert.equal(prevSegment("scorecard"), "segue");
  });

  test("clamps at the end instead of overflowing past 'done'", () => {
    assert.equal(nextSegment("done"), "done");
  });

  test("clamps at the start instead of underflowing past 'segue'", () => {
    assert.equal(prevSegment("segue"), "segue");
  });

  test("next/prev are inverses at every interior step", () => {
    for (let i = 1; i < SEGMENTS.length - 1; i++) {
      const s = SEGMENTS[i];
      assert.equal(prevSegment(nextSegment(s)), s);
    }
  });
});

describe("isSegment", () => {
  test("accepts every real segment value", () => {
    for (const s of SEGMENTS) assert.equal(isSegment(s), true);
  });

  test("rejects unknown strings and empty/nullish input", () => {
    assert.equal(isSegment("not-a-segment"), false);
    assert.equal(isSegment(""), false);
    assert.equal(isSegment(null), false);
    assert.equal(isSegment(undefined), false);
  });
});

describe("meeting structure invariants", () => {
  test("'done' is a terminal marker: exactly one, and last in SEGMENTS", () => {
    const doneCount = SEGMENTS.filter((s) => s === "done").length;
    assert.equal(doneCount, 1);
    assert.equal(SEGMENTS[SEGMENTS.length - 1], "done");
    // meeting-rail.tsx derives its visible stage list via
    // SEGMENTS.filter(s => s !== "done") — if this assumption ever breaks,
    // that filter silently produces the wrong agenda.
  });

  test("active-segment durations sum to the advertised meeting total", () => {
    const sum = SEGMENTS.filter((s) => s !== "done").reduce(
      (total, s) => total + SEGMENT_DURATION_SECONDS[s],
      0,
    );
    assert.equal(sum, TOTAL_MEETING_SECONDS);
  });

  test("no active segment has a non-positive duration", () => {
    for (const s of SEGMENTS.filter((x) => x !== "done")) {
      assert.ok(
        SEGMENT_DURATION_SECONDS[s] > 0,
        `${s} must have a positive duration budget`,
      );
    }
  });

  test("'segue' is first — the stage every new meeting opens on", () => {
    // startMeeting() writes current_segment: "segue", advanceSegment() falls
    // back to it, and meeting-rail.tsx disables Back there. All three assume
    // it sits at index 0.
    assert.equal(SEGMENTS[0], "segue");
  });
});

describe("segment copy", () => {
  test("every segment has a label and a hint", () => {
    for (const s of SEGMENTS) {
      assert.ok(SEGMENT_LABELS[s]?.trim(), `${s} is missing a label`);
      assert.ok(SEGMENT_HINTS[s]?.trim(), `${s} is missing a hint`);
    }
  });

  test("hints never promise a removed assistant/AI feature", () => {
    // The Gemini assistant was pulled from the app (see the standing
    // constraints in CLAUDE.md). The Issues hint used to end with "(the
    // Assistant can add it)" and shipped that dead promise to the screen for
    // the whole Issues segment. Copy must not reintroduce it.
    for (const s of SEGMENTS) {
      assert.ok(
        !/assistant|gemini/i.test(SEGMENT_HINTS[s]),
        `${s} hint references a removed feature`,
      );
    }
  });
});

describe("normalizeSegment", () => {
  test("maps legacy ids key to issues", () => {
    assert.equal(normalizeSegment("ids"), "issues");
  });
  test("passes through modern segment keys", () => {
    assert.equal(normalizeSegment("issues"), "issues");
    assert.equal(normalizeSegment("segue"), "segue");
  });
  test("rejects unknown values", () => {
    assert.equal(normalizeSegment("not-a-segment"), null);
  });
});
