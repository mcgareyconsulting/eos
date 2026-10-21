import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isRecapTodoVisible } from "./recap-todos";

describe("isRecapTodoVisible", () => {
  test("team-visible and legacy to-dos show", () => {
    assert.equal(isRecapTodoVisible({ visibility: "team", owner_id: "u2" }), true);
    assert.equal(isRecapTodoVisible({ owner_id: "u2" }), true);
  });

  test("rock milestones are excluded", () => {
    assert.equal(isRecapTodoVisible({ source_rock_id: "r1" }), false);
  });

  test("a private to-do is never on the recap — not for its owner, creator or an admin", () => {
    assert.equal(isRecapTodoVisible({ visibility: "private", owner_id: "u2" }), false);
    assert.equal(isRecapTodoVisible({ visibility: "private" }), false);
    assert.equal(
      isRecapTodoVisible({ visibility: "private", owner_id: "u1", created_by: "u1" }),
      false,
    );
  });
});
