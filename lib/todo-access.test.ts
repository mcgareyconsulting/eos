import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canChangeTodoVisibility, canMutateTodo } from "./todo-access";

const member = { uid: "u1", isAdmin: false, membershipRole: "member" };

describe("canMutateTodo", () => {
  test("any team member may change a team-visible to-do", () => {
    assert.equal(canMutateTodo({ visibility: "team", owner_id: "u2" }, member), true);
    // Legacy rows without a visibility field read as team-visible.
    assert.equal(canMutateTodo({ owner_id: "u2" }, member), true);
  });

  test("a member may not change someone else's private to-do", () => {
    assert.equal(
      canMutateTodo({ visibility: "private", owner_id: "u2", created_by: "u3" }, member),
      false,
    );
  });

  test("the assignee may change their private to-do", () => {
    assert.equal(canMutateTodo({ visibility: "private", owner_id: "u1" }, member), true);
  });

  test("the creator may change a private to-do they assigned to someone else", () => {
    assert.equal(
      canMutateTodo({ visibility: "private", owner_id: "u2", created_by: "u1" }, member),
      true,
    );
  });

  test("a team leader has no power over a private to-do (spec §3.2)", () => {
    assert.equal(
      canMutateTodo(
        { visibility: "private", owner_id: "u2", created_by: "u2" },
        { ...member, membershipRole: "leader" },
      ),
      false,
    );
  });

  test("an org admin may change any private to-do, rostered or not", () => {
    assert.equal(
      canMutateTodo(
        { visibility: "private", owner_id: "u2" },
        { uid: "admin", isAdmin: true, membershipRole: null },
      ),
      true,
    );
  });

  test("a private to-do with no owner or creator is admin only", () => {
    assert.equal(canMutateTodo({ visibility: "private", owner_id: null }, member), false);
    assert.equal(canMutateTodo({ visibility: "private" }, { ...member, uid: "" }), false);
  });
});

describe("canChangeTodoVisibility", () => {
  const priv = { visibility: "private", owner_id: "u2", created_by: "u3" };
  test("private → team: creator or assignee only", () => {
    assert.equal(canChangeTodoVisibility(priv, { uid: "u2" }, "team"), true);
    assert.equal(canChangeTodoVisibility(priv, { uid: "u3" }, "team"), true);
    assert.equal(canChangeTodoVisibility(priv, { uid: "admin" }, "team"), false);
    assert.equal(canChangeTodoVisibility(priv, { uid: "u1" }, "team"), false);
  });
  test("keeping it private, or making a team to-do private, is not gated here", () => {
    assert.equal(canChangeTodoVisibility(priv, { uid: "admin" }, "private"), true);
    assert.equal(
      canChangeTodoVisibility({ visibility: "team", owner_id: "u2" }, { uid: "u1" }, "private"),
      true,
    );
  });
});
