import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_EXEMPT_KINDS,
  NO_ACCESS_TEXT,
  addedFollowerRecipients,
  applyFollowerEdit,
  filterByAccess,
  initialFollowers,
  itemLabel,
  kindForEvent,
  notificationColumn,
  notificationHref,
  notificationVerb,
  planRecipients,
  snippetOf,
  summarizeTodoChanges,
  todoEditEvents,
} from "./notifications";

describe("to-do follower pickers", () => {
  test("a new to-do is followed by its creator and its owner", () => {
    assert.deepEqual(initialFollowers({ creatorId: "me", ownerId: "you" }), ["me", "you"]);
    assert.deepEqual(initialFollowers({ creatorId: "me", ownerId: "me" }), ["me"]);
    assert.deepEqual(initialFollowers({ creatorId: "me", ownerId: null }), ["me"]);
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
  });

  test("editing the list keeps the locked followers and diffs the rest", () => {
    assert.deepEqual(
      applyFollowerEdit({
        current: ["me", "you", "old"],
        ownerId: "you",
        picked: ["new", "me"],
        visibility: "team",
      }),
      { next: ["you", "new", "me"], added: ["new"], removed: ["old"] },
    );
    // The assigner cannot be unticked either.
    assert.deepEqual(
      applyFollowerEdit({
        current: ["boss", "you", "x"],
        ownerId: "you",
        lockedIds: ["boss"],
        picked: [],
        visibility: "team",
      }),
      { next: ["you", "boss"], added: [], removed: ["x"] },
    );
    // Private: only the locked followers stay.
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
});

describe("planRecipients", () => {
  test("the actor never hears about their own action", () => {
    assert.deepEqual(
      planRecipients({ followers: ["me", "you"], event: "completed", actorId: "me" }),
      [{ uid: "you", kind: "completed" }],
    );
    assert.deepEqual(
      planRecipients({
        followers: [],
        event: null,
        actorId: "me",
        direct: { assigned: ["me"] },
      }),
      [],
    );
  });

  test("a mentioned follower gets the mention, not a second comment row", () => {
    assert.deepEqual(
      planRecipients({
        followers: ["author", "owner", "watcher"],
        event: "comment",
        actorId: "author",
        direct: { mention: ["owner", "outsider", "author"] },
      }),
      [
        { uid: "owner", kind: "mention" },
        { uid: "outsider", kind: "mention" },
        { uid: "watcher", kind: "comment" },
      ],
    );
  });

  test("direct kinds follow the precedence order; one row per person", () => {
    const plan = planRecipients({
      followers: ["a", "b", "c", "d"],
      event: "reassigned",
      actorId: "z",
      direct: { following: ["a", "b"], assigned: ["a"], unassigned: ["c"] },
    });
    assert.deepEqual(plan, [
      { uid: "a", kind: "assigned" },
      { uid: "c", kind: "unassigned" },
      { uid: "b", kind: "following" },
      { uid: "d", kind: "updated" },
    ]);
  });

  test("no event: followers hear nothing, only the named people", () => {
    assert.deepEqual(
      planRecipients({
        followers: ["f1", "f2"],
        event: null,
        actorId: "z",
        direct: { audience_added: ["f1", "x"] },
      }),
      [
        { uid: "f1", kind: "audience_added" },
        { uid: "x", kind: "audience_added" },
      ],
    );
  });

  test("events map onto the hub's kinds", () => {
    assert.equal(kindForEvent("comment"), "comment");
    for (const e of ["completed", "solved", "discussed", "milestone_completed"] as const) {
      assert.equal(kindForEvent(e), "completed", e);
    }
    assert.equal(kindForEvent("reopened"), "reopened");
    for (const e of ["title_changed", "owner_changed", "value_posted", "archived"] as const) {
      assert.equal(kindForEvent(e), "updated", e);
    }
  });
});

describe("filterByAccess (send-time check)", () => {
  const plan = [
    { uid: "sees", kind: "comment" as const },
    { uid: "blind", kind: "mention" as const },
    { uid: "blind2", kind: "assigned" as const },
    { uid: "lost", kind: "unassigned" as const },
    { uid: "leader", kind: "metric_private" as const },
  ];
  test("drops recipients who cannot see the item", () => {
    const out = filterByAccess(plan, (uid) => uid === "sees");
    assert.deepEqual(
      out.map((d) => d.uid),
      ["sees", "lost", "leader"],
    );
  });
  test("only the 'you lost it' kinds are exempt", () => {
    assert.deepEqual([...ACCESS_EXEMPT_KINDS].sort(), ["metric_private", "unassigned"]);
  });
});

describe("what the row says", () => {
  const nameOf = (id: string) => ({ s: "Steph Benes" })[id];
  const due = (iso: string) => `d(${iso})`;

  test("summarises title, owner and due changes for the trace", () => {
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
        { title: "A", owner_id: "j", due_date: null },
        { title: "A ", owner_id: "j", due_date: null },
        nameOf,
        due,
      ),
      null,
    );
  });

  test("to-do edits fire the spec's events, most significant first", () => {
    const base = { title: "A", owner_id: "j", due_date: null, description: null };
    assert.deepEqual(todoEditEvents(base, { ...base }), []);
    assert.deepEqual(
      todoEditEvents(base, { ...base, title: "B", owner_id: "k", description: "x" }),
      ["reassigned", "title_changed", "description_changed"],
    );
    assert.deepEqual(todoEditEvents(base, { ...base, due_date: "2026-10-01" }), [
      "due_date_changed",
    ]);
  });

  test("snippets collapse whitespace and truncate with an ellipsis", () => {
    assert.equal(snippetOf("  hello\n\n  world "), "hello world");
    const s = snippetOf("x".repeat(200), 20);
    assert.equal(s.length, 20);
    assert.ok(s.endsWith("…"));
  });

  test("verbs: with a read-time title, or the item's noun without one", () => {
    assert.equal(
      notificationVerb({ kind: "assigned", entity_type: "todo" }, "Call Jane"),
      "assigned you “Call Jane”",
    );
    assert.equal(
      notificationVerb({ kind: "assigned", entity_type: "todo" }),
      "assigned you a to-do",
    );
    assert.equal(
      notificationVerb({ kind: "updated", event: "due_date_changed", entity_type: "todo" }, "X"),
      "changed the due date of “X”",
    );
    assert.equal(
      notificationVerb({ kind: "mention", event: "comment", entity_type: "issue" }),
      "mentioned you on an issue",
    );
    // Legacy rows: no event.
    assert.equal(
      notificationVerb({ kind: "updated", entity_type: "todo" }),
      "updated a to-do",
    );
    assert.equal(
      notificationVerb({ kind: "following", entity_type: "todo" }, "Ship it"),
      "added you as a follower on “Ship it”",
    );
  });

  test("links come from the registry", () => {
    assert.equal(
      notificationHref({ team_id: "t1", entity_type: "todo", entity_id: "a b" }),
      "/teams/t1/todos?todo=a%20b",
    );
    assert.equal(
      notificationHref({ team_id: "t1", entity_type: "issue", entity_id: "i1" }),
      "/teams/t1/issues?issue=i1",
    );
  });

  test("labels: title + snippet per type", () => {
    assert.deepEqual(itemLabel("metric", { name: " Calls ", description: "x" }), {
      title: "Calls",
      snippet: "x",
    });
    assert.deepEqual(itemLabel("headline", { title: "H", body: "b" }), {
      title: "H",
      snippet: "b",
    });
    assert.deepEqual(itemLabel("todo", { title: "T" }), { title: "T", snippet: null });
    assert.equal(NO_ACCESS_TEXT, "You do not have access to this item.");
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
      "unassigned",
      "audience_added",
      "metric_private",
      "following",
    ] as const) {
      assert.equal(notificationColumn({ kind }), "activity");
    }
  });
});
