import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canMutateTodo } from "./todo-access";

const member = { uid: "u1", isAdmin: false, membershipRole: "member" };

describe("canMutateTodo", () => {
  test("any team member may change a team-visible to-do", () => {
    assert.equal(canMutateTodo({ visibility: "team", owner_id: "u2" }, member), true);
    // Legacy rows without a visibility field read as team-visible.
    assert.equal(canMutateTodo({ owner_id: "u2" }, member), true);
  });

  test("a member may not change someone else's private to-do (C-11)", () => {
    assert.equal(
      canMutateTodo({ visibility: "private", owner_id: "u2" }, member),
      false,
    );
  });

  test("the owner may change their own private to-do", () => {
    assert.equal(
      canMutateTodo({ visibility: "private", owner_id: "u1" }, member),
      true,
    );
  });

  test("a team leader may change a member's private to-do", () => {
    assert.equal(
      canMutateTodo(
        { visibility: "private", owner_id: "u2" },
        { ...member, membershipRole: "leader" },
      ),
      true,
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

  test("a private to-do with no owner is leader/admin only", () => {
    assert.equal(canMutateTodo({ visibility: "private", owner_id: null }, member), false);
    assert.equal(
      canMutateTodo({ visibility: "private" }, { ...member, uid: "" }),
      false,
    );
  });
});
