import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampSpeakerIndex,
  compareBySpeakingOrder,
  currentSpeakerUid,
  firstPresentIndex,
  ownersPresentThenAbsent,
  presentOrder,
  reconcileSpeakingOrder,
  stepSpeakerIndex,
} from "./speaking-order";

// The stored order is per-team and long-lived, so it drifts out of sync with
// the roster between meetings. These tests pin the reconciliation rules that
// keep a stale array usable, and the pointer arithmetic that has to stay in
// bounds while people are marked absent mid-meeting.

const members = [
  { user_id: "u-sarah", full_name: "Sarah Chen" },
  { user_id: "u-marcus", full_name: "Marcus Reed" },
  { user_id: "u-elena", full_name: "Elena Vasquez" },
];

describe("reconcileSpeakingOrder", () => {
  test("preserves a stored order that still matches the roster", () => {
    const stored = ["u-marcus", "u-elena", "u-sarah"];
    assert.deepEqual(reconcileSpeakingOrder(stored, members), stored);
  });

  test("falls back to the alphabetical roster when nothing is stored", () => {
    // Meetings created before this feature shipped have no stored order —
    // they must still produce a usable round rather than an empty rail.
    const expected = ["u-elena", "u-marcus", "u-sarah"];
    assert.deepEqual(reconcileSpeakingOrder(null, members), expected);
    assert.deepEqual(reconcileSpeakingOrder(undefined, members), expected);
    assert.deepEqual(reconcileSpeakingOrder([], members), expected);
  });

  test("appends a newly joined member alphabetically, after stored entries", () => {
    const stored = ["u-marcus", "u-sarah"];
    const withNewcomers = [
      ...members,
      { user_id: "u-tom", full_name: "Tom Bradley" },
    ];
    assert.deepEqual(reconcileSpeakingOrder(stored, withNewcomers), [
      "u-marcus",
      "u-sarah",
      "u-elena",
      "u-tom",
    ]);
  });

  test("drops uids that are no longer team members", () => {
    const stored = ["u-departed", "u-marcus", "u-sarah", "u-elena"];
    assert.deepEqual(reconcileSpeakingOrder(stored, members), [
      "u-marcus",
      "u-sarah",
      "u-elena",
    ]);
  });

  test("collapses duplicate uids to their first position", () => {
    const stored = ["u-sarah", "u-marcus", "u-sarah"];
    assert.deepEqual(reconcileSpeakingOrder(stored, members), [
      "u-sarah",
      "u-marcus",
      "u-elena",
    ]);
  });

  test("returns an empty order for an empty roster", () => {
    assert.deepEqual(reconcileSpeakingOrder(["u-sarah"], []), []);
  });

  test("does not mutate the caller's members array", () => {
    const input = [...members];
    reconcileSpeakingOrder(null, input);
    assert.deepEqual(input, members);
  });
});

describe("clampSpeakerIndex", () => {
  test("keeps an in-range index untouched", () => {
    assert.equal(clampSpeakerIndex(1, 3), 1);
  });

  test("clamps past either end rather than indexing off the order", () => {
    assert.equal(clampSpeakerIndex(9, 3), 2);
    assert.equal(clampSpeakerIndex(-4, 3), 0);
  });

  test("pins to 0 for an empty order or a non-finite index", () => {
    assert.equal(clampSpeakerIndex(2, 0), 0);
    assert.equal(clampSpeakerIndex(Number.NaN, 3), 0);
  });
});

describe("stepSpeakerIndex", () => {
  const order = ["u-sarah", "u-marcus", "u-elena"];

  test("advances and retreats one position when nobody is absent", () => {
    assert.equal(stepSpeakerIndex(order, 0, [], 1), 1);
    assert.equal(stepSpeakerIndex(order, 2, [], -1), 1);
  });

  test("skips over an absent person", () => {
    assert.equal(stepSpeakerIndex(order, 0, ["u-marcus"], 1), 2);
  });

  test("stays put when there is nobody eligible in that direction", () => {
    assert.equal(stepSpeakerIndex(order, 2, [], 1), 2);
    assert.equal(stepSpeakerIndex(order, 0, [], -1), 0);
    // Everyone ahead is absent — the control goes inert rather than landing
    // on someone who isn't in the room.
    assert.equal(stepSpeakerIndex(order, 0, ["u-marcus", "u-elena"], 1), 0);
  });

  test("handles an empty order and an out-of-range starting index", () => {
    assert.equal(stepSpeakerIndex([], 0, [], 1), 0);
    assert.equal(stepSpeakerIndex(order, 99, [], -1), 1);
  });
});

describe("firstPresentIndex", () => {
  const order = ["u-sarah", "u-marcus", "u-elena"];

  test("picks the first person actually in the room", () => {
    assert.equal(firstPresentIndex(order, []), 0);
    assert.equal(firstPresentIndex(order, ["u-sarah"]), 1);
    assert.equal(firstPresentIndex(order, ["u-sarah", "u-marcus"]), 2);
  });

  test("falls back to 0 when everyone is absent or the order is empty", () => {
    assert.equal(firstPresentIndex(order, order), 0);
    assert.equal(firstPresentIndex([], []), 0);
  });
});

describe("presentOrder", () => {
  const order = ["u-sarah", "u-marcus", "u-elena"];

  test("drops absent people from the rotation entirely", () => {
    assert.deepEqual(presentOrder(order, ["u-marcus"]), [
      "u-sarah",
      "u-elena",
    ]);
  });

  test("returns the whole order when nobody is absent", () => {
    assert.deepEqual(presentOrder(order, []), order);
  });

  test("returns empty when everyone is absent", () => {
    assert.deepEqual(presentOrder(order, order), []);
  });
});

describe("ownersPresentThenAbsent", () => {
  const order = ["u-sarah", "u-marcus", "u-elena", "u-tom"];

  test("moves absentees after all present people, preserving relative order", () => {
    // Marcus absent but was #2 — must not sit above Elena/Tom who are present.
    assert.deepEqual(ownersPresentThenAbsent(order, ["u-marcus"]), [
      "u-sarah",
      "u-elena",
      "u-tom",
      "u-marcus",
    ]);
  });

  test("keeps full speaking order when nobody is absent", () => {
    assert.deepEqual(ownersPresentThenAbsent(order, []), order);
  });
});

describe("currentSpeakerUid", () => {
  const order = ["u-sarah", "u-marcus", "u-elena"];

  test("resolves the pointer against the full stored order", () => {
    assert.equal(currentSpeakerUid(order, 1, []), "u-marcus");
  });

  test("passes the floor to the NEXT present person when the pointer lands on someone absent", () => {
    // Marking the current speaker absent must not blank out the highlight —
    // and must not throw the round back to person #1 either.
    assert.equal(currentSpeakerUid(order, 1, ["u-marcus"]), "u-elena");
  });

  test("wraps to the front only when nobody after the pointer is present", () => {
    assert.equal(currentSpeakerUid(order, 2, ["u-elena"]), "u-sarah");
  });

  test("returns null when the order is empty or everyone is absent", () => {
    assert.equal(currentSpeakerUid([], 0, []), null);
    assert.equal(currentSpeakerUid(order, 0, order), null);
  });

  test("clamps an out-of-range pointer instead of returning undefined", () => {
    assert.equal(currentSpeakerUid(order, 99, []), "u-elena");
  });
});

describe("compareBySpeakingOrder", () => {
  const order = ["u-marcus", "u-sarah", "u-elena"];

  test("orders rows by owner speaking sequence, then sort_order", () => {
    const rows = [
      { owner_id: "u-elena", sort_order: 0, name: "E1" },
      { owner_id: "u-marcus", sort_order: 1, name: "M2" },
      { owner_id: "u-marcus", sort_order: 0, name: "M1" },
      { owner_id: "u-sarah", sort_order: 0, name: "S1" },
      { owner_id: null, sort_order: 0, name: "Team" },
    ];
    const sorted = [...rows].sort((a, b) =>
      compareBySpeakingOrder(a, b, order),
    );
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["M1", "M2", "S1", "E1", "Team"],
    );
  });
});
