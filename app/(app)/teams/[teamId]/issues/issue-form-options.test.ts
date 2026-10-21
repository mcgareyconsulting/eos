import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_TERM_OPTIONS,
  issueOwnerName,
  toPriorityValue,
} from "./issue-form-options";

describe("ISSUE_PRIORITY_OPTIONS", () => {
  test("No priority first, then the levels most-urgent first", () => {
    assert.deepEqual(
      ISSUE_PRIORITY_OPTIONS.map((o) => [o.value, o.label]),
      [
        ["", "No priority"],
        ["urgent", "Urgent"],
        ["high", "High"],
        ["medium", "Medium"],
        ["low", "Low"],
      ],
    );
  });
});

describe("ISSUE_TERM_OPTIONS", () => {
  test("Short-term then Long-term, with the values the actions accept", () => {
    assert.deepEqual(
      ISSUE_TERM_OPTIONS.map((o) => [o.value, o.label]),
      [
        ["short", "Short-term"],
        ["long", "Long-term"],
      ],
    );
  });
});

describe("toPriorityValue", () => {
  test("keeps a known level", () => {
    assert.equal(toPriorityValue("high"), "high");
  });
  test("null, empty and unknown values become no priority", () => {
    assert.equal(toPriorityValue(null), "");
    assert.equal(toPriorityValue(undefined), "");
    assert.equal(toPriorityValue(""), "");
    assert.equal(toPriorityValue("critical"), "");
  });
});

describe("issueOwnerName", () => {
  const members = [
    { user_id: "u1", full_name: "Ada Lovelace" },
    { user_id: "u2", full_name: "Grace Hopper" },
  ];

  test('"" is Unassigned', () => {
    assert.equal(issueOwnerName("", members, "u1"), "Unassigned");
  });
  test("a team member shows their name, even when it is the viewer", () => {
    assert.equal(issueOwnerName("u2", members, "u1"), "Grace Hopper");
    assert.equal(issueOwnerName("u1", members, "u1"), "Ada Lovelace");
  });
  test("the viewer off the roster (admin on a team they aren't on) is You", () => {
    assert.equal(issueOwnerName("admin", members, "admin"), "You");
  });
  test("a kept owner who has left the team is labelled, not blank", () => {
    assert.equal(issueOwnerName("gone", members, "u1"), "Not on this team");
  });
});
