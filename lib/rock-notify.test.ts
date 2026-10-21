import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  audienceAdded,
  reassignmentRecipients,
  rockEditEvents,
} from "./rock-notify";

describe("audienceAdded", () => {
  test("only newly added people and teams", () => {
    assert.deepEqual(
      audienceAdded(
        { teamIds: ["t1"], userIds: ["u1"] },
        { teamIds: ["t1", "t2"], userIds: ["u1", "u2"] },
        "boss",
      ),
      { teamIds: ["t2"], userIds: ["u2"] },
    );
  });
  test("a new rock tells the whole audience, never the actor", () => {
    assert.deepEqual(
      audienceAdded(
        { teamIds: [], userIds: [] },
        { teamIds: ["t1", "t1"], userIds: ["boss", "u2"] },
        "boss",
      ),
      { teamIds: ["t1"], userIds: ["u2"] },
    );
  });
  test("removals and no change tell nobody", () => {
    assert.deepEqual(
      audienceAdded(
        { teamIds: ["t1"], userIds: ["u1"] },
        { teamIds: [], userIds: ["u1"] },
        "boss",
      ),
      { teamIds: [], userIds: [] },
    );
  });
});

describe("reassignmentRecipients", () => {
  test("new owner assigned, old owner unassigned", () => {
    assert.deepEqual(reassignmentRecipients("a", "b", "boss"), {
      assigned: ["b"],
      unassigned: ["a"],
    });
  });
  test("unchanged owner tells nobody", () => {
    assert.deepEqual(reassignmentRecipients("a", "a", "boss"), {
      assigned: [],
      unassigned: [],
    });
  });
  test("the actor is not told about their own action", () => {
    assert.deepEqual(reassignmentRecipients("boss", "b", "boss"), {
      assigned: ["b"],
      unassigned: [],
    });
    assert.deepEqual(reassignmentRecipients("a", "boss", "boss"), {
      assigned: [],
      unassigned: ["a"],
    });
  });
  test("a new milestone has no previous owner", () => {
    assert.deepEqual(reassignmentRecipients(null, "b", "boss"), {
      assigned: ["b"],
      unassigned: [],
    });
  });
});

describe("rockEditEvents", () => {
  test("owner and due date", () => {
    assert.deepEqual(
      rockEditEvents(
        { owner_id: "a", due_date: "2026-01-01" },
        { owner_id: "b", due_date: "2026-02-01" },
      ),
      ["owner_changed", "due_date_changed"],
    );
  });
  test("null and undefined are the same", () => {
    assert.deepEqual(rockEditEvents({ due_date: null }, { due_date: undefined }), []);
  });
});
