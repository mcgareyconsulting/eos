import { test } from "node:test";
import assert from "node:assert/strict";
import { commentDraftKey, hasCommentDraft, setCommentDraft } from "./comment-drafts";

test("tracks unposted comments per item", () => {
  const k = commentDraftKey("todo", "m1");
  assert.equal(hasCommentDraft(k), false);
  setCommentDraft(k, true);
  assert.equal(hasCommentDraft(k), true);
  assert.equal(hasCommentDraft(commentDraftKey("todo", "m2")), false);
  setCommentDraft(k, false);
  assert.equal(hasCommentDraft(k), false);
});
