import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { selectTodosToCompleteFromGoogle } from "./tasks";

describe("selectTodosToCompleteFromGoogle", () => {
  const owner = "user-1";

  test("marks incomplete EOS todos when Google task is completed", () => {
    const ids = selectTodosToCompleteFromGoogle(
      [
        { id: "g1", status: "completed" },
        { id: "g2", status: "needsAction" },
      ],
      [
        {
          id: "t1",
          google_task_id: "g1",
          owner_id: owner,
          completed_at: null,
        },
        {
          id: "t2",
          google_task_id: "g2",
          owner_id: owner,
          completed_at: null,
        },
      ],
      owner,
    );
    assert.deepEqual(ids, ["t1"]);
  });

  test("skips already-completed EOS todos", () => {
    const ids = selectTodosToCompleteFromGoogle(
      [{ id: "g1", status: "completed" }],
      [
        {
          id: "t1",
          google_task_id: "g1",
          owner_id: owner,
          completed_at: { toMillis: () => 1 },
        },
      ],
      owner,
    );
    assert.deepEqual(ids, []);
  });

  test("skips todos owned by another user", () => {
    const ids = selectTodosToCompleteFromGoogle(
      [{ id: "g1", status: "completed" }],
      [
        {
          id: "t1",
          google_task_id: "g1",
          owner_id: "other",
          completed_at: null,
        },
      ],
      owner,
    );
    assert.deepEqual(ids, []);
  });

  test("skips todos without a google_task_id", () => {
    const ids = selectTodosToCompleteFromGoogle(
      [{ id: "g1", status: "completed" }],
      [{ id: "t1", google_task_id: null, owner_id: owner, completed_at: null }],
      owner,
    );
    assert.deepEqual(ids, []);
  });

  test("does not reopen when Google is needsAction", () => {
    const ids = selectTodosToCompleteFromGoogle(
      [{ id: "g1", status: "needsAction" }],
      [
        {
          id: "t1",
          google_task_id: "g1",
          owner_id: owner,
          completed_at: null,
        },
      ],
      owner,
    );
    assert.deepEqual(ids, []);
  });

  test("returns empty when ownerUid is blank", () => {
    const ids = selectTodosToCompleteFromGoogle(
      [{ id: "g1", status: "completed" }],
      [
        {
          id: "t1",
          google_task_id: "g1",
          owner_id: owner,
          completed_at: null,
        },
      ],
      "",
    );
    assert.deepEqual(ids, []);
  });
});
