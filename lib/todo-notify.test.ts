import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { todoAccess } from "./access";
import { VIEWERS, PARENT } from "./access/test-viewers";
import { applyFollow, assignmentPatch, followersAfterAccessChange } from "./follow";
import { assignmentRecipients, planRecipients } from "./notifications";

describe("assignmentRecipients", () => {
  test("reassign: new owner assigned, old owner unassigned", () => {
    assert.deepEqual(
      assignmentRecipients({ prevOwnerId: "a", nextOwnerId: "b", actorId: "x" }),
      { assigned: ["b"], unassigned: ["a"] },
    );
  });
  test("actor is never told about their own action", () => {
    assert.deepEqual(
      assignmentRecipients({ prevOwnerId: "a", nextOwnerId: "x", actorId: "x" }),
      { assigned: [], unassigned: ["a"] },
    );
    assert.deepEqual(
      assignmentRecipients({ prevOwnerId: "x", nextOwnerId: "b", actorId: "x" }),
      { assigned: ["b"], unassigned: [] },
    );
  });
  test("unchanged owner tells nobody", () => {
    assert.deepEqual(
      assignmentRecipients({ prevOwnerId: "a", nextOwnerId: "a", actorId: "x" }),
      { assigned: [], unassigned: [] },
    );
  });
  test("old owner (now a plain follower) gets unassigned, not a follower row", () => {
    const before = { owner_id: "a", assigned_by: "boss", follower_ids: [] };
    const patch = assignmentPatch("todo", before, "b", "x");
    const who = assignmentRecipients({ prevOwnerId: "a", nextOwnerId: "b", actorId: "x" });
    const plan = planRecipients({
      followers: patch.follower_ids,
      event: "reassigned",
      actorId: "x",
      direct: who,
    });
    const kind = (u: string) => plan.find((d) => d.uid === u)?.kind;
    assert.equal(kind("a"), "unassigned");
    assert.equal(kind("b"), "assigned");
    assert.equal(kind("boss"), "updated");
  });
});

describe("locked followers on to-dos", () => {
  const todo = { owner_id: "own", assigned_by: "boss", follower_ids: ["fan"] };
  test("owner and assigner cannot unfollow", () => {
    assert.deepEqual(applyFollow("todo", todo, "own", false), { ok: false, reason: "locked" });
    assert.deepEqual(applyFollow("todo", todo, "boss", false), { ok: false, reason: "locked" });
    assert.equal(applyFollow("todo", todo, "fan", false).ok, true);
  });
  test("milestones lock the same way", () => {
    assert.deepEqual(applyFollow("milestone", todo, "own", false), { ok: false, reason: "locked" });
  });
  test("after reassignment the old owner can unfollow", () => {
    const p = assignmentPatch("todo", todo, "new", "x");
    const after = { owner_id: "new", assigned_by: p.assigned_by, follower_ids: p.follower_ids };
    assert.equal(applyFollow("todo", after, "own", false).ok, true);
    assert.equal(applyFollow("todo", after, "boss", false).ok, true);
    assert.deepEqual(applyFollow("todo", after, "x", false), { ok: false, reason: "locked" });
  });
});

describe("followers when a to-do goes private", () => {
  const priv = {
    team_id: PARENT,
    visibility: "private" as const,
    created_by: "u-mem",
    owner_id: "u-asg",
    assigned_by: "u-mem",
    follower_ids: ["u-lead", "u-admin", "u-out", "u-mem", "u-asg"],
  };
  const canSee = (uid: string) => {
    const v = Object.values(VIEWERS).find((x) => x.uid === uid);
    return !!v && todoAccess.canSee(priv, v);
  };
  test("only creator, assignee and admins stay", () => {
    const next = followersAfterAccessChange("todo", priv, canSee);
    assert.deepEqual([...next].sort(), ["u-admin", "u-asg", "u-mem"]);
  });
  test("private -> team does not resurrect pruned followers", () => {
    const pruned = followersAfterAccessChange("todo", priv, canSee);
    const back = { ...priv, visibility: "team", follower_ids: pruned };
    assert.deepEqual(
      followersAfterAccessChange("todo", back, () => true).sort(),
      [...pruned].sort(),
    );
    assert.ok(!pruned.includes("u-lead"));
  });
});
