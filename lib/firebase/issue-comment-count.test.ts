import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "../test-support/fake-firestore";
import { deleteIssueComment, postIssueComment } from "./issue-comment-count";

const STAMPED_AT = "t-solved";

/** Issue i1, solved by alice; `extra` seeds comment_count (or leaves it off). */
function seed(extra: Record<string, unknown> = {}): FakeFirestore {
  const f = new FakeFirestore();
  f.seed("issues", "i1", {
    team_id: "T",
    title: "Printer",
    status: "solved",
    solved_at: STAMPED_AT,
    updated_by: "alice",
    updated_at: STAMPED_AT,
    ...extra,
  });
  return f;
}

function comment(by: string, issueId = "i1") {
  return {
    team_id: "T",
    entity_type: "issue",
    entity_id: issueId,
    body: "hi",
    author_id: by,
    updated_by: by,
  };
}

async function post(f: FakeFirestore, by: string, issueId = "i1") {
  const db = f.asFirestore();
  const ref = db.collection("entity_comments").doc();
  await postIssueComment(db, ref, comment(by, issueId), issueId);
  return ref;
}

function countOf(f: FakeFirestore, id = "i1") {
  return f.raw(`issues/${id}`)?.comment_count;
}

describe("issue comment_count", () => {
  test("posting a comment writes the comment and adds 1", async () => {
    const f = seed({ comment_count: 2 });
    const ref = await post(f, "bob");
    assert.equal(f.raw(`entity_comments/${ref.id}`)?.author_id, "bob");
    assert.equal(countOf(f), 3);
  });

  test("deleting a comment removes it and takes 1 off", async () => {
    const f = seed({ comment_count: 0 });
    const db = f.asFirestore();
    const a = await post(f, "bob");
    await post(f, "carol");
    assert.equal(countOf(f), 2);
    assert.equal(await deleteIssueComment(db, a, "i1"), true);
    assert.equal(f.raw(`entity_comments/${a.id}`), undefined);
    assert.equal(countOf(f), 1);
  });

  test("deleting the same comment twice counts once — in turn or racing", async () => {
    const f = seed({ comment_count: 0 });
    const db = f.asFirestore();
    const a = await post(f, "bob");
    const b = await post(f, "bob");
    await post(f, "bob");
    assert.equal(countOf(f), 3);

    assert.equal(await deleteIssueComment(db, a, "i1"), true);
    assert.equal(await deleteIssueComment(db, a, "i1"), false);
    assert.equal(countOf(f), 2);

    const results = await Promise.all([
      deleteIssueComment(db, b, "i1"),
      deleteIssueComment(db, b, "i1"),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(countOf(f), 1);
  });

  test("a pre-feature issue (no field) self-corrects to the thread's true size", async () => {
    // Three comments posted before the counter shipped; one on another issue.
    const f = seed();
    f.seed("issues", "i2", { team_id: "T" });
    f.seed("entity_comments", "old1", comment("bob"));
    f.seed("entity_comments", "old2", comment("carol"));
    f.seed("entity_comments", "old3", comment("dave"));
    f.seed("entity_comments", "other", comment("bob", "i2"));
    // A row filed under the same entity_id with another type is not counted.
    f.seed("entity_comments", "rock", { ...comment("bob"), entity_type: "rock" });
    const db = f.asFirestore();

    // Delete: 3 − 1 = 2, not the −1 a blind decrement would store.
    assert.equal(await deleteIssueComment(db, db.collection("entity_comments").doc("old1"), "i1"), true);
    assert.equal(countOf(f), 2);
    assert.equal(countOf(f, "i2"), undefined);

    // Post on a pre-feature issue: 3 + 1 = 4, not 1.
    const g = seed();
    g.seed("entity_comments", "old1", comment("bob"));
    g.seed("entity_comments", "old2", comment("carol"));
    g.seed("entity_comments", "old3", comment("dave"));
    await post(g, "erin");
    assert.equal(countOf(g), 4);
  });

  test("the stored count never goes below 0", async () => {
    // Drifted low (a stored 0 with a comment still in the thread).
    const f = seed({ comment_count: 0 });
    f.seed("entity_comments", "c1", comment("bob"));
    const db = f.asFirestore();
    await deleteIssueComment(db, db.collection("entity_comments").doc("c1"), "i1");
    assert.equal(countOf(f), 0);

    // Already negative from an older bug: a post lands on 1.
    const g = seed({ comment_count: -2 });
    await post(g, "bob");
    assert.equal(countOf(g), 1);
  });

  test("comment activity leaves the issue's updated_by / updated_at alone", async () => {
    const f = seed();
    const db = f.asFirestore();
    const before = { ...f.raw("issues/i1") };
    const a = await post(f, "bob");
    await post(f, "carol");
    await deleteIssueComment(db, a, "i1");
    const after = f.raw("issues/i1")!;
    assert.equal(after.updated_by, "alice");
    assert.equal(after.updated_at, STAMPED_AT);
    // Only the counter moved.
    const { comment_count, ...rest } = after;
    assert.equal(comment_count, 1);
    assert.deepEqual(rest, before);
  });

  test("an issue that is gone gets no counter, and the comment still posts or deletes", async () => {
    const f = new FakeFirestore();
    const ref = await post(f, "bob", "gone");
    assert.equal(f.raw(`entity_comments/${ref.id}`)?.entity_id, "gone");
    assert.equal(f.raw("issues/gone"), undefined);
    assert.equal(await deleteIssueComment(f.asFirestore(), ref, "gone"), true);
    assert.equal(f.raw(`entity_comments/${ref.id}`), undefined);
    assert.equal(f.raw("issues/gone"), undefined);
  });
});
