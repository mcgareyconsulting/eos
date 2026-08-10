import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
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
