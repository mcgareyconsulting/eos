import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFollow,
  assignerOf,
  assignmentPatch,
  autoFollowStampActor,
  effectiveFollowers,
  isFollowing,
  isLockedFollower,
  lockedFollowers,
  withAutoFollowers,
} from "./follow";

describe("locked followers", () => {
  test("owner + assigned_by are locked", () => {
    const todo = { owner_id: "own", assigned_by: "boss", created_by: "old", follower_ids: ["x"] };
    assert.deepEqual(lockedFollowers("todo", todo), ["own", "boss"]);
    assert.equal(isLockedFollower("todo", todo, "own"), true);
    assert.equal(isLockedFollower("todo", todo, "boss"), true);
    assert.equal(isLockedFollower("todo", todo, "old"), false);
    assert.equal(isLockedFollower("todo", todo, "x"), false);
  });

  test("legacy docs: created_by stands in for assigned_by", () => {
    assert.equal(assignerOf("todo", { created_by: "maker" }), "maker");
    assert.equal(assignerOf("issue", { assigned_by: "", created_by: "maker" }), "maker");
    assert.equal(assignerOf("rock", {}), null);
    assert.equal(isLockedFollower("todo", { owner_id: "o", created_by: "maker" }, "maker"), true);
  });

  test("a headline has no assigner; its creator is the locked owner", () => {
    const h = { created_by: "writer", assigned_by: "ignored" };
    assert.equal(assignerOf("headline", h), null);
    assert.deepEqual(lockedFollowers("headline", h), ["writer"]);
  });

  test("locked followers follow even when not stored", () => {
    const doc = { owner_id: "own", assigned_by: "boss", follower_ids: ["fan", "own"] };
    assert.deepEqual(effectiveFollowers("todo", doc), ["own", "boss", "fan"]);
    assert.equal(isFollowing("todo", doc, "boss"), true);
    assert.equal(isFollowing("todo", doc, "nobody"), false);
    assert.deepEqual(effectiveFollowers("issue", {}), []);
  });
});

describe("applyFollow", () => {
  const doc = { owner_id: "own", assigned_by: "boss", follower_ids: ["fan"] };

  test("follow adds once", () => {
    assert.deepEqual(applyFollow("todo", doc, "new", true), {
      ok: true,
      follower_ids: ["fan", "new"],
      changed: true,
    });
    assert.deepEqual(applyFollow("todo", doc, "fan", true), {
      ok: true,
      follower_ids: ["fan"],
      changed: false,
    });
  });

  test("anyone unlocked may unfollow", () => {
    assert.deepEqual(applyFollow("todo", doc, "fan", false), {
      ok: true,
      follower_ids: [],
      changed: true,
    });
  });

  test("the owner and the assigner are refused", () => {
    assert.deepEqual(applyFollow("todo", doc, "own", false), { ok: false, reason: "locked" });
    assert.deepEqual(applyFollow("todo", doc, "boss", false), { ok: false, reason: "locked" });
    // …but following again is a no-op, not an error.
    assert.equal(applyFollow("todo", doc, "own", true).ok, true);
  });
});

describe("reassignment", () => {
  const before = { owner_id: "a", assigned_by: "boss", follower_ids: ["fan"] };

  test("new owner + new assigner lock; old ones stay as unlocked followers", () => {
    const p = assignmentPatch("todo", before, "b", "lead");
    assert.equal(p.reassigned, true);
    assert.equal(p.assigned_by, "lead");
    assert.deepEqual(p.follower_ids, ["fan", "a", "boss", "b", "lead"]);
    const after = { owner_id: "b", assigned_by: p.assigned_by, follower_ids: p.follower_ids };
    assert.equal(isLockedFollower("todo", after, "b"), true);
    assert.equal(isLockedFollower("todo", after, "lead"), true);
    assert.equal(isLockedFollower("todo", after, "a"), false);
    assert.equal(isLockedFollower("todo", after, "boss"), false);
    assert.equal(isFollowing("todo", after, "a"), true);
    assert.equal(applyFollow("todo", after, "a", false).ok, true);
  });

  test("legacy doc: the old created_by assigner is kept as a follower", () => {
    const p = assignmentPatch("todo", { owner_id: "a", created_by: "maker" }, "b", "lead");
    assert.deepEqual(p.follower_ids, ["a", "maker", "b", "lead"]);
  });

  test("unchanged owner changes nothing", () => {
    const p = assignmentPatch("todo", before, "a", "lead");
    assert.deepEqual(p, { assigned_by: "boss", follower_ids: ["fan"], reassigned: false });
  });

  test("headline: no assigner is written", () => {
    const p = assignmentPatch("headline", { created_by: "w" }, "x", "lead");
    assert.equal(p.assigned_by, null);
  });
});

describe("auto-follow", () => {
  test("adds the new people only", () => {
    assert.deepEqual(withAutoFollowers({ follower_ids: ["a"] }, ["a", "b", null, "b"]), {
      follower_ids: ["a", "b"],
      added: ["b"],
    });
  });
});

describe("autoFollowStampActor", () => {
  test("issues are never re-stamped by a comment's auto-follow", () => {
    assert.equal(autoFollowStampActor("issue", "u1"), null);
  });
  test("other item types keep the commenter as the audit actor", () => {
    assert.equal(autoFollowStampActor("todo", "u1"), "u1");
    assert.equal(autoFollowStampActor("rock", "u1"), "u1");
  });
});
