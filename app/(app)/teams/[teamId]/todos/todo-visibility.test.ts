import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  privateAudience,
  stepChoice,
  todoVisibilityChoices,
  visibilityForNewTodo,
} from "./todo-visibility";

describe("privateAudience", () => {
  test("your own to-do for yourself: you and admins", () => {
    assert.equal(
      privateAudience({ creatorId: "me", ownerId: "me", viewerId: "me" }),
      "Only you and admins can see it.",
    );
  });
  test("you created it for someone else", () => {
    assert.equal(
      privateAudience({ creatorId: "me", ownerId: "bob", viewerId: "me" }),
      "Only you, the owner and admins can see it.",
    );
  });
  test("someone created it for you", () => {
    assert.equal(
      privateAudience({ creatorId: "ann", ownerId: "me", viewerId: "me" }),
      "Only you, its creator and admins can see it.",
    );
  });
  test("an admin editing someone else's", () => {
    assert.equal(
      privateAudience({ creatorId: "ann", ownerId: "bob", viewerId: "admin" }),
      "Only its creator, the owner and admins can see it.",
    );
    assert.equal(
      privateAudience({ creatorId: "bob", ownerId: "bob", viewerId: "admin" }),
      "Only the owner and admins can see it.",
    );
  });
  test("legacy to-do with no creator", () => {
    assert.equal(
      privateAudience({ creatorId: null, ownerId: "me", viewerId: "me" }),
      "Only you and admins can see it.",
    );
    assert.equal(
      privateAudience({ creatorId: null, ownerId: "bob", viewerId: "admin" }),
      "Only the owner and admins can see it.",
    );
  });
  test("no owner picked", () => {
    assert.equal(
      privateAudience({ creatorId: "me", ownerId: "", viewerId: "me" }),
      "Only you and admins can see it.",
    );
  });
});

describe("todoVisibilityChoices", () => {
  const who = { creatorId: "me", ownerId: "bob", viewerId: "me" };
  test("Team then Private, values match the form field", () => {
    const c = todoVisibilityChoices({ canPublish: true, ...who });
    assert.deepEqual(
      c.map((o) => [o.value, o.label, o.disabled]),
      [
        ["team", "Team", false],
        ["private", "Private", false],
      ],
    );
    assert.match(c[0].description, /L10/);
    assert.match(c[1].description, /^Only you, the owner and admins/);
    assert.match(c[1].description, /Never shows on the L10/);
  });
  test("Team is disabled when the viewer may not publish", () => {
    const c = todoVisibilityChoices({ canPublish: false, ...who });
    assert.equal(c[0].disabled, true);
    assert.equal(c[1].disabled, false);
  });
});

describe("stepChoice", () => {
  const both = todoVisibilityChoices({
    canPublish: true,
    creatorId: "me",
    ownerId: "me",
    viewerId: "me",
  });
  test("moves and wraps both ways", () => {
    assert.equal(stepChoice(both, "team", 1), "private");
    assert.equal(stepChoice(both, "private", 1), "team");
    assert.equal(stepChoice(both, "team", -1), "private");
    assert.equal(stepChoice(both, "private", -1), "team");
  });
  test("skips a disabled choice", () => {
    const locked = both.map((c) =>
      c.value === "team" ? { ...c, disabled: true } : c,
    );
    assert.equal(stepChoice(locked, "private", 1), "private");
    assert.equal(stepChoice(locked, "private", -1), "private");
  });
});

describe("visibilityForNewTodo", () => {
  test("outside a meeting: what the form asked for", () => {
    assert.equal(visibilityForNewTodo("private", null), "private");
    assert.equal(visibilityForNewTodo("team", null), "team");
  });
  test("captured in an L10: always team, even if the form sent private", () => {
    assert.equal(visibilityForNewTodo("private", "m1"), "team");
    assert.equal(visibilityForNewTodo("team", "m1"), "team");
  });
  test("anything unrecognised or missing is team", () => {
    assert.equal(visibilityForNewTodo("public", null), "team");
    assert.equal(visibilityForNewTodo(null, null), "team");
    assert.equal(visibilityForNewTodo(undefined, null), "team");
  });
});
