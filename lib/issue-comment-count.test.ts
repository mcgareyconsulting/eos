import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  commentCountLabel,
  commentCountOf,
  planCommentCountBackfill,
} from "./issue-comment-count";

describe("commentCountOf", () => {
  test("a positive count is shown as-is", () => {
    assert.equal(commentCountOf({ comment_count: 3 }), 3);
  });

  test("missing, null, non-numeric and non-finite read as 0", () => {
    assert.equal(commentCountOf({}), 0);
    assert.equal(commentCountOf(null), 0);
    assert.equal(commentCountOf(undefined), 0);
    assert.equal(commentCountOf({ comment_count: "4" }), 0);
    assert.equal(commentCountOf({ comment_count: Number.NaN }), 0);
    assert.equal(commentCountOf({ comment_count: Number.POSITIVE_INFINITY }), 0);
  });

  test("a decrement that raced below zero never shows a negative count", () => {
    assert.equal(commentCountOf({ comment_count: -1 }), 0);
  });
});

describe("commentCountLabel", () => {
  test("singular and plural", () => {
    assert.equal(commentCountLabel(1), "1 comment");
    assert.equal(commentCountLabel(2), "2 comments");
  });
});

describe("planCommentCountBackfill", () => {
  const issues = [
    { id: "i1", data: {} },
    { id: "i2", data: { comment_count: 2 } },
    { id: "i3", data: { comment_count: 5 } },
    { id: "i4", data: {} },
  ];
  const comments = [
    { entity_type: "issue", entity_id: "i1" },
    { entity_type: "issue", entity_id: "i2" },
    { entity_type: "issue", entity_id: "i2" },
    // Another type's thread with the same id is not this issue's.
    { entity_type: "todo", entity_id: "i1" },
    // The issue was deleted and its purge never ran.
    { entity_type: "issue", entity_id: "gone" },
    { entity_type: "issue" },
  ];

  test("writes only the issues whose stored count is wrong", () => {
    const plan = planCommentCountBackfill(issues, comments);
    assert.deepEqual(plan.writes, [
      { issueId: "i1", before: undefined, after: 1 },
      { issueId: "i3", before: 5, after: 0 },
    ]);
    // i2 is already right; i4 has no comments and no field.
    assert.equal(plan.unchanged, 2);
    assert.equal(plan.orphans, 1);
  });
});
