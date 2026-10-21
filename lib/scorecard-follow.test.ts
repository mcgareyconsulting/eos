import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { privateTransition, removeShare } from "./scorecard-share";
import { assignmentPatch, isFollowing } from "./follow";
import { metricAccess } from "./access/metric";
import type { Viewer } from "./access/types";
import { PARENT, SHARED, UNRELATED, VIEWERS } from "./access/test-viewers";
import {
  followersToPrune,
  isNewValue,
  metricEditEvents,
  prunedFollowerIds,
} from "./scorecard-follow";

const V = (...vs: Viewer[]) => new Map(vs.map((v) => [v.uid, v]));

const tracked = {
  team_id: PARENT,
  is_public: true,
  owner_id: VIEWERS.parentLeader.uid,
  assigned_by: VIEWERS.admin.uid,
  shared_team_ids: [SHARED, UNRELATED],
  follower_ids: [
    VIEWERS.parentMember.uid, // home team
    VIEWERS.sharedMember.uid, // tracking team SHARED only
    VIEWERS.outsider.uid, // tracking team UNRELATED only
    VIEWERS.admin.uid,
  ],
};

describe("follow gate", () => {
  test("home team, tracking team and admin may follow; the board is not enough", () => {
    assert.equal(metricAccess.canFollow(tracked, VIEWERS.parentMember), true);
    assert.equal(metricAccess.canFollow(tracked, VIEWERS.sharedMember), true);
    assert.equal(metricAccess.canFollow(tracked, VIEWERS.admin), true);
    assert.equal(metricAccess.canFollow(tracked, VIEWERS.outsider), true); // UNRELATED tracks it
    assert.equal(metricAccess.canFollow(tracked, VIEWERS.assignee), false); // sees it, no scorecard
  });
});

describe("assignment on create / owner change", () => {
  test("create: owner and creator follow; creator is the assigner", () => {
    const p = assignmentPatch("metric", {}, "o", "maker");
    assert.equal(p.assigned_by, "maker");
    assert.deepEqual([...p.follower_ids].sort(), ["maker", "o"]);
  });
  test("reassign: old owner and old assigner stay, but unlocked", () => {
    const before = { owner_id: "old", assigned_by: "oldboss", follower_ids: [] };
    const p = assignmentPatch("metric", before, "new", "boss");
    assert.equal(p.reassigned, true);
    const after = { ...before, owner_id: "new", ...p };
    assert.equal(isFollowing("metric", after, "old"), true);
    assert.equal(isFollowing("metric", after, "oldboss"), true);
    assert.equal(assignmentPatch("metric", after, "new", "x").reassigned, false);
  });
});

describe("pruning followers", () => {
  test("untrack: only followers whose sole path was that team go", () => {
    const after = { ...tracked, shared_team_ids: removeShare(tracked, SHARED) };
    const viewers = V(
      VIEWERS.parentMember,
      VIEWERS.sharedMember,
      VIEWERS.outsider,
      VIEWERS.admin,
    );
    assert.deepEqual(followersToPrune(after, viewers), [VIEWERS.sharedMember.uid]);
    assert.deepEqual(prunedFollowerIds(after, viewers), [
      VIEWERS.parentMember.uid,
      VIEWERS.outsider.uid,
      VIEWERS.admin.uid,
    ]);
  });
  test("a follower on two paths keeps following", () => {
    const both = { ...tracked, follower_ids: ["both"] };
    const v: Viewer = {
      uid: "both",
      isAdmin: false,
      teamIds: new Set([SHARED, UNRELATED]),
      leaderOf: new Set(),
    };
    const after = { ...both, shared_team_ids: removeShare(both, SHARED) };
    assert.deepEqual(followersToPrune(after, V(v)), []);
  });
  test("private: everyone off the home team goes; home team and admin stay", () => {
    const after = { ...tracked, ...privateTransition(tracked).patch };
    const viewers = V(
      VIEWERS.parentMember,
      VIEWERS.sharedMember,
      VIEWERS.outsider,
      VIEWERS.admin,
    );
    assert.deepEqual(followersToPrune(after, viewers), [
      VIEWERS.sharedMember.uid,
      VIEWERS.outsider.uid,
    ]);
  });
  test("the locked owner and assigner are never pruned; unknown users are", () => {
    const m = {
      ...tracked,
      is_public: false,
      shared_team_ids: [],
      owner_id: VIEWERS.sharedMember.uid,
      assigned_by: VIEWERS.outsider.uid,
      follower_ids: [VIEWERS.sharedMember.uid, VIEWERS.outsider.uid, "gone"],
    };
    const viewers = V(VIEWERS.sharedMember, VIEWERS.outsider);
    assert.deepEqual(followersToPrune(m, viewers), ["gone"]);
  });
});

describe("events", () => {
  const before = { goal: 10, direction: "gte", owner_id: "a" };
  test("no change, no events", () => {
    assert.deepEqual(
      metricEditEvents(before, { goal: 10, direction: "gte", owner_id: "a" }),
      [],
    );
  });
  test("goal, direction and owner diff", () => {
    assert.deepEqual(
      metricEditEvents(before, { goal: 12, direction: "gte", owner_id: "a" }),
      ["goal_changed"],
    );
    assert.deepEqual(
      metricEditEvents(before, { goal: 10, direction: "lte", owner_id: "a" }),
      ["goal_changed"],
    );
    assert.deepEqual(
      metricEditEvents(before, { goal: 10, direction: "gte", owner_id: "b" }),
      ["owner_changed"],
    );
    assert.deepEqual(
      metricEditEvents(before, { goal: null, direction: "gte", owner_id: null }),
      ["goal_changed", "owner_changed"],
    );
    assert.deepEqual(
      metricEditEvents({}, { goal: null, direction: "gte", owner_id: null }),
      [],
    );
  });
  test("value_posted only for a new number", () => {
    assert.equal(isNewValue(undefined, 5), true);
    assert.equal(isNewValue(4, 5), true);
    assert.equal(isNewValue(5, 5), false);
    assert.equal(isNewValue(5, null), false);
    assert.equal(isNewValue(null, 0), true);
  });
});
