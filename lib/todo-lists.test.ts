import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assignedPillText,
  isAssignedFromOtherTeam,
  listShowsTodo,
  outsideOwnerIds,
} from "./todo-lists";

describe("listShowsTodo — private never on the team's lists (spec §3.2)", () => {
  const priv = { visibility: "private", owner_id: "asg", created_by: "cre" };
  test("team to-dos show to everyone on the page", () => {
    assert.equal(listShowsTodo({ visibility: "team", owner_id: "x" }, "anyone"), true);
    assert.equal(listShowsTodo({ owner_id: "x" }, "anyone"), true);
  });
  test("private: creator and assignee only — not leaders, not admins", () => {
    assert.equal(listShowsTodo(priv, "asg"), true);
    assert.equal(listShowsTodo(priv, "cre"), true);
    assert.equal(listShowsTodo(priv, "leader"), false);
    assert.equal(listShowsTodo(priv, "admin"), false);
    assert.equal(listShowsTodo({ visibility: "private", owner_id: null }, ""), false);
  });
});

describe("isAssignedFromOtherTeam (D1)", () => {
  const mine = { team_id: "C", owner_id: "me", visibility: "team" };
  test("my plain to-do on a team I'm not on", () => {
    assert.equal(isAssignedFromOtherTeam(mine, "me", new Set(["A", "B"])), true);
    assert.equal(isAssignedFromOtherTeam({ ...mine, visibility: "private" }, "me", ["A"]), true);
  });
  test("not when I'm on that team, not mine, a milestone, or archived", () => {
    assert.equal(isAssignedFromOtherTeam(mine, "me", ["C"]), false);
    assert.equal(isAssignedFromOtherTeam(mine, "you", ["A"]), false);
    assert.equal(isAssignedFromOtherTeam({ ...mine, source_rock_id: "r" }, "me", ["A"]), false);
    assert.equal(isAssignedFromOtherTeam({ ...mine, archived_at: 1 }, "me", ["A"]), false);
  });
});

describe("assignedPillText", () => {
  const names = (id: string) => ({ dana: "Dana Lee" })[id];
  test("names the assigner and the team", () => {
    assert.equal(
      assignedPillText({ assigned_by: "dana" }, "me", names, "Ops"),
      "Assigned by Dana Lee · Ops",
    );
  });
  test("falls back to created_by, then 'someone'; 'you' for self", () => {
    assert.equal(assignedPillText({ created_by: "dana" }, "me", names, "Ops"), "Assigned by Dana Lee · Ops");
    assert.equal(assignedPillText({ assigned_by: "zed" }, "me", names, undefined), "Assigned by someone · another team");
    assert.equal(assignedPillText({ assigned_by: "me" }, "me", names, "Ops"), "Assigned by you · Ops");
  });
});

describe("outsideOwnerIds", () => {
  test("owners not on the roster, once each", () => {
    const roster = new Set(["a", "b"]);
    assert.deepEqual(
      outsideOwnerIds([{ owner_id: "a" }, { owner_id: "x" }, { owner_id: "x" }, { owner_id: null }], roster),
      ["x"],
    );
  });
});
