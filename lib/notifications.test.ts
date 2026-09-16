import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  addedFollowerRecipients,
  applyFollowerEdit,
  commentRecipients,
  followersAfterOwnerChange,
  initialFollowers,
  notificationColumn,
  notificationHref,
  notificationVerb,
  recipientsFor,
  snippetOf,
  summarizeTodoChanges,
  toggleFollower,
} from "./notifications";
import { writeNotifications } from "./firebase/notifications";
import { FakeFirestore } from "./test-support/fake-firestore";

describe("follow relation", () => {
  test("a new to-do is followed by its creator and its owner", () => {
    assert.deepEqual(
      initialFollowers({ creatorId: "me", ownerId: "you" }),
      ["me", "you"],
    );
    assert.deepEqual(initialFollowers({ creatorId: "me", ownerId: "me" }), [
      "me",
    ]);
    assert.deepEqual(initialFollowers({ creatorId: "me", ownerId: null }), [
      "me",
    ]);
  });

  test("explicit picks at creation follow too, without doubling anyone", () => {
    assert.deepEqual(
      initialFollowers({
        creatorId: "me",
        ownerId: "you",
        extraIds: ["them", "you", "me", null],
      }),
      ["me", "you", "them"],
    );
  });

  test("only the extra picks hear they were added", () => {
    assert.deepEqual(
      addedFollowerRecipients({
        creatorId: "me",
        ownerId: "you",
        extraIds: ["them", "you", "me", "them"],
      }),
      ["them"],
    );
    assert.deepEqual(
      addedFollowerRecipients({ creatorId: "me", ownerId: null, extraIds: [] }),
      [],
    );
  });

  test("reassigning adds the new owner and keeps everyone else", () => {
    assert.deepEqual(followersAfterOwnerChange(["a", "b"], "c"), [
      "a",
      "b",
      "c",
    ]);
    assert.deepEqual(followersAfterOwnerChange(["a", "b"], "b"), ["a", "b"]);
    assert.deepEqual(followersAfterOwnerChange(undefined, "z"), ["z"]);
  });

  test("editing the follower list keeps the owner and diffs the rest", () => {
    assert.deepEqual(
      applyFollowerEdit({
        current: ["me", "you", "old"],
        ownerId: "you",
        picked: ["new", "me"],
        visibility: "team",
      }),
      { next: ["you", "new", "me"], added: ["new"], removed: ["old"] },
    );
    // Private: nobody but the owner, whatever was picked.
    assert.deepEqual(
      applyFollowerEdit({
        current: ["me", "you"],
        ownerId: "you",
        picked: ["me", "them"],
        visibility: "private",
      }),
      { next: ["you"], added: [], removed: ["me"] },
    );
  });

  test("toggle follows and unfollows without duplicates", () => {
    assert.deepEqual(toggleFollower(["a"], "b", true), ["a", "b"]);
    assert.deepEqual(toggleFollower(["a", "b"], "b", true), ["a", "b"]);
    assert.deepEqual(toggleFollower(["a", "b"], "a", false), ["b"]);
    assert.deepEqual(toggleFollower(null, "a", false), []);
  });
});

describe("who gets told", () => {
  test("the actor never hears about their own action", () => {
    assert.deepEqual(
      recipientsFor({
        followerIds: ["me", "you"],
        actorId: "me",
        visibility: "team",
        ownerId: "you",
      }),
      ["you"],
    );
  });

  test("a private to-do only ever tells its owner", () => {
    assert.deepEqual(
      recipientsFor({
        followerIds: ["creator", "owner", "lurker"],
        actorId: "creator",
        visibility: "private",
        ownerId: "owner",
      }),
      ["owner"],
    );
  });

  test("a mentioned follower gets the mention, not a second comment row", () => {
    const r = commentRecipients({
      followerIds: ["author", "owner", "watcher"],
      mentionedIds: ["owner", "outsider", "author"],
      actorId: "author",
      visibility: "team",
      ownerId: "owner",
    });
    assert.deepEqual(r.mention, ["owner", "outsider"]);
    assert.deepEqual(r.comment, ["watcher"]);
  });
});

describe("what the row says", () => {
  const nameOf = (id: string) => ({ s: "Steph Benes" })[id];
  const due = (iso: string) => `d(${iso})`;

  test("summarises title, owner and due changes; ignores the rest", () => {
    assert.equal(
      summarizeTodoChanges(
        { title: "A", owner_id: "j", due_date: "2026-09-20" },
        { title: "B", owner_id: "s", due_date: "2026-09-27" },
        nameOf,
        due,
      ),
      "Renamed to “B” · Owner Steph Benes · Due d(2026-09-27)",
    );
    assert.equal(
      summarizeTodoChanges(
        { title: "A", owner_id: "j", due_date: "2026-09-20" },
        { title: "A ", owner_id: "j", due_date: "2026-09-20" },
        nameOf,
        due,
      ),
      null,
    );
    assert.equal(
      summarizeTodoChanges(
        { title: "A", owner_id: "j", due_date: "2026-09-20" },
        { title: "A", owner_id: null, due_date: null },
        nameOf,
        due,
      ),
      "Owner No Owner · Due date cleared",
    );
  });

  test("snippets collapse whitespace and truncate with an ellipsis", () => {
    assert.equal(snippetOf("  hello\n\n  world "), "hello world");
    const long = "x".repeat(200);
    const s = snippetOf(long, 20);
    assert.equal(s.length, 20);
    assert.ok(s.endsWith("…"));
  });

  test("verbs and links", () => {
    assert.equal(
      notificationVerb({ kind: "assigned", entity_title: "Call Jane" }),
      "assigned you “Call Jane”",
    );
    assert.equal(
      notificationHref({ team_id: "t1", entity_type: "todo", entity_id: "a b" }),
      "/teams/t1/todos?todo=a%20b",
    );
  });
});

describe("hub columns", () => {
  test("mentions get their own column; everything else is activity", () => {
    assert.equal(notificationColumn({ kind: "mention" }), "mentions");
    for (const kind of [
      "comment",
      "completed",
      "reopened",
      "updated",
      "assigned",
      "following",
    ] as const) {
      assert.equal(notificationColumn({ kind }), "activity");
    }
  });

  test("the following verb reads as an invitation, not an assignment", () => {
    assert.equal(
      notificationVerb({ kind: "following", entity_title: "Ship it" }),
      "added you as a follower on “Ship it”",
    );
  });
});

describe("writing rows", () => {
  test("one row per recipient, actor name resolved once from /users", async () => {
    const fake = new FakeFirestore();
    fake.seed("users", "actor", { display_name: "Steph Benes" });
    const n = await writeNotifications({
      db: fake.asFirestore(),
      recipientIds: ["a", "b", "a", ""],
      kind: "completed",
      team: { id: "t1", name: "ESD" },
      entity: { type: "todo", id: "todo-1", title: "Ship it" },
      actor: { id: "actor" },
    });
    assert.equal(n, 2);
    const rows = fake.docsIn("notifications").map((d) => d.data);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.user_id).sort(),
      ["a", "b"],
    );
    assert.equal(rows[0].actor_name, "Steph Benes");
    assert.equal(rows[0].kind, "completed");
    assert.equal(rows[0].detail, null);
    assert.equal(rows[0].read_at, null);
  });

  test("no recipients writes nothing and never touches /users", async () => {
    const fake = new FakeFirestore();
    const n = await writeNotifications({
      db: fake.asFirestore(),
      recipientIds: [],
      kind: "comment",
      team: { id: "t1", name: "ESD" },
      entity: { type: "todo", id: "todo-1", title: "Ship it" },
      actor: { id: "ghost" },
    });
    assert.equal(n, 0);
    assert.equal(fake.docsIn("notifications").length, 0);
  });

  test("an unnamed actor falls back to Someone", async () => {
    const fake = new FakeFirestore();
    await writeNotifications({
      db: fake.asFirestore(),
      recipientIds: ["a"],
      kind: "mention",
      team: { id: "t1", name: "ESD" },
      entity: { type: "todo", id: "todo-1", title: "Ship it" },
      actor: { id: "ghost" },
      detail: "  hey  ",
    });
    const row = fake.docsIn("notifications")[0].data;
    assert.equal(row.actor_name, "Someone");
    assert.equal(row.detail, "hey");
  });
});
