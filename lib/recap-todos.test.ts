import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isRecapTodoVisible } from "./recap-todos";

describe("isRecapTodoVisible", () => {
  test("team-visible and legacy to-dos show", () => {
    assert.equal(isRecapTodoVisible({ visibility: "team", owner_id: "u2" }, "u1"), true);
    assert.equal(isRecapTodoVisible({ owner_id: "u2" }, "u1"), true);
  });

  test("rock milestones are excluded", () => {
    assert.equal(isRecapTodoVisible({ source_rock_id: "r1" }, "u1"), false);
  });

  test("someone else's private to-do is hidden", () => {
    assert.equal(isRecapTodoVisible({ visibility: "private", owner_id: "u2" }, "u1"), false);
    assert.equal(isRecapTodoVisible({ visibility: "private" }, "u1"), false);
  });

  test("the owner still sees their own private to-do", () => {
    assert.equal(isRecapTodoVisible({ visibility: "private", owner_id: "u1" }, "u1"), true);
  });

  test("the creator of a private to-do assigned to someone else sees it (P8a)", () => {
    assert.equal(
      isRecapTodoVisible({ visibility: "private", owner_id: "u2", created_by: "u1" }, "u1"),
      true,
    );
  });
});
