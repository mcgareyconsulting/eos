import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MILESTONE_REMINDER_DAYS,
  isMilestoneDueSoon,
  isMilestoneHiddenByRock,
  type MilestoneParentRock,
} from "./milestone-visibility";

describe("isMilestoneHiddenByRock", () => {
  test("keeps milestones under an active rock", () => {
    assert.equal(
      isMilestoneHiddenByRock({ status: "on_track", archived_at: null }),
      false,
    );
    assert.equal(
      isMilestoneHiddenByRock({ status: "off_track", archived_at: null }),
      false,
    );
  });

  test("hides milestones under a done rock", () => {
    assert.equal(
      isMilestoneHiddenByRock({ status: "done", archived_at: null }),
      true,
    );
  });

  test("hides milestones under a cancelled rock", () => {
    assert.equal(
      isMilestoneHiddenByRock({ status: "cancelled", archived_at: null }),
      true,
    );
  });

  test("hides milestones under an archived rock regardless of status", () => {
    const archived: MilestoneParentRock = {
      status: "on_track",
      archived_at: { toMillis: () => 1 },
    };
    assert.equal(isMilestoneHiddenByRock(archived), true);
  });

  test("keeps milestones when the parent rock is missing (conservative)", () => {
    assert.equal(isMilestoneHiddenByRock(null), false);
    assert.equal(isMilestoneHiddenByRock(undefined), false);
  });
});

describe("isMilestoneDueSoon (N29)", () => {
  // Fixed reference so the window is deterministic, not "today".
  const from = new Date("2026-08-24T12:00:00Z");

  test("surfaces anything due inside the two-week window", () => {
    assert.equal(isMilestoneDueSoon("2026-08-24", from), true);
    assert.equal(isMilestoneDueSoon("2026-08-31", from), true);
    assert.equal(isMilestoneDueSoon("2026-09-07", from), true); // day 14
  });

  test("drops anything further out than the window", () => {
    assert.equal(isMilestoneDueSoon("2026-09-08", from), false); // day 15
    assert.equal(isMilestoneDueSoon("2026-12-01", from), false);
  });

  test("keeps overdue milestones — past due is more urgent, not less", () => {
    assert.equal(isMilestoneDueSoon("2026-08-23", from), true);
    assert.equal(isMilestoneDueSoon("2026-05-01", from), true);
  });

  test("excludes undated milestones — they can't be due in any window", () => {
    assert.equal(isMilestoneDueSoon(null, from), false);
    assert.equal(isMilestoneDueSoon(undefined, from), false);
    assert.equal(isMilestoneDueSoon("", from), false);
  });

  test("the window is adjustable and defaults to two weeks", () => {
    assert.equal(MILESTONE_REMINDER_DAYS, 14);
    assert.equal(isMilestoneDueSoon("2026-09-08", from, 30), true);
    assert.equal(isMilestoneDueSoon("2026-08-31", from, 3), false);
  });
});
