import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assignedPillText,
  homeShowsTodo,
  isAssignedFromOtherTeam,
  l10ShowsTodo,
  listShowsTodo,
  outsideOwnerIds,
  surfaceShowsTodo,
} from "./todo-lists";

describe("listShowsTodo — private: creator, assignee, admins (spec §3.2)", () => {
  const priv = { visibility: "private", owner_id: "asg", created_by: "cre" };
  test("team to-dos show to everyone on the page", () => {
    assert.equal(listShowsTodo({ visibility: "team", owner_id: "x" }, "anyone"), true);
    assert.equal(listShowsTodo({ owner_id: "x" }, "anyone"), true);
  });
  test("private: creator and assignee — not leaders, not other members", () => {
    assert.equal(listShowsTodo(priv, "asg"), true);
    assert.equal(listShowsTodo(priv, "cre"), true);
    assert.equal(listShowsTodo(priv, "leader"), false);
    assert.equal(listShowsTodo(priv, "leader", false), false);
    assert.equal(listShowsTodo({ visibility: "private", owner_id: null }, ""), false);
  });
  test("private: an admin sees every one", () => {
    assert.equal(listShowsTodo(priv, "admin", true), true);
    assert.equal(listShowsTodo({ visibility: "private", owner_id: null }, "admin", true), true);
  });
});

describe("surfaceShowsTodo — lists, Home and the L10 share one predicate", () => {
  const priv = { visibility: "private", owner_id: "asg", created_by: "cre" };
  const team = { visibility: "team", owner_id: "asg" };
  const viewers = {
    assignee: { uid: "asg" },
    creator: { uid: "cre" },
    admin: { uid: "adm", isAdmin: true },
    leader: { uid: "lead" },
    member: { uid: "mem" },
  };
  test("lists and Home: private to creator, assignee, admin only", () => {
    for (const surface of ["list", "home"] as const) {
      assert.equal(surfaceShowsTodo(priv, viewers.assignee, surface), true);
      assert.equal(surfaceShowsTodo(priv, viewers.creator, surface), true);
      assert.equal(surfaceShowsTodo(priv, viewers.admin, surface), true);
      assert.equal(surfaceShowsTodo(priv, viewers.leader, surface), false);
      assert.equal(surfaceShowsTodo(priv, viewers.member, surface), false);
    }
  });
  test("L10: private to no one, admins and parties included", () => {
    for (const v of Object.values(viewers)) {
      assert.equal(surfaceShowsTodo(priv, v, "l10"), false);
    }
    assert.equal(l10ShowsTodo(priv), false);
  });
  test("team to-dos show on every surface to everyone", () => {
    for (const surface of ["list", "home", "l10"] as const) {
      for (const v of Object.values(viewers)) {
        assert.equal(surfaceShowsTodo(team, v, surface), true);
      }
    }
    assert.equal(l10ShowsTodo({ owner_id: "x" }), true);
  });
  test("wrappers agree with the predicate", () => {
    assert.equal(homeShowsTodo(priv, "adm", true), true);
    assert.equal(homeShowsTodo(priv, "lead"), false);
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
