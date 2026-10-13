import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  eventsFromActivity,
  eventsFromStatusHistory,
  feedCountLabel,
  feedEventSentence,
  feedEventVerb,
  mergeTimeline,
  milestoneEventsFromActivity,
  tsMs,
  type ActivityRowLike,
  type FeedComment,
  type FeedEvent,
} from "./activity-feed";
import { SYSTEM_ACTOR_ID } from "./activity";

const comment = (id: string, ms: number | null): FeedComment => ({
  id,
  author_id: "u1",
  body: `body ${id}`,
  created_at: ms,
});

const event = (id: string, ms: number | null, over: Partial<FeedEvent> = {}): FeedEvent => ({
  id,
  kind: "updated",
  actorId: "u2",
  actorName: "Casey Nolan",
  ms,
  ...over,
});

const row = (id: string, over: Partial<ActivityRowLike> = {}): ActivityRowLike => ({
  id,
  entity_id: "m1",
  kind: "completed",
  actor_id: "u2",
  actor_name: "Casey Nolan",
  detail: null,
  created_at: 1000,
  ...over,
});

describe("tsMs", () => {
  test("reads millis, Timestamps and pending values", () => {
    assert.equal(tsMs(5), 5);
    assert.equal(tsMs({ toMillis: () => 7 }), 7);
    assert.equal(tsMs(null), null);
    assert.equal(tsMs(undefined), null);
  });
});

describe("mergeTimeline", () => {
  test("interleaves comments and events newest first", () => {
    const items = mergeTimeline(
      [comment("c1", 100), comment("c2", 300)],
      [event("e1", 200), event("e2", 400)],
    );
    assert.deepEqual(
      items.map((i) => i.key),
      ["event:e2", "comment:c2", "event:e1", "comment:c1"],
    );
  });

  test("a pending server timestamp sorts as the newest", () => {
    const items = mergeTimeline([comment("c1", 100), comment("c2", null)], [event("e1", 200)]);
    assert.deepEqual(
      items.map((i) => i.key),
      ["comment:c2", "event:e1", "comment:c1"],
    );
  });

  test("ties are broken by key so re-delivered snapshots don't reshuffle", () => {
    const a = mergeTimeline([comment("a", 100), comment("b", 100)], [event("x", 100)]);
    const b = mergeTimeline([comment("b", 100), comment("a", 100)], [event("x", 100)]);
    assert.deepEqual(
      a.map((i) => i.key),
      b.map((i) => i.key),
    );
  });

  test("drops the trace's `commented` mirror, keeps `comment_deleted`", () => {
    const items = mergeTimeline(
      [comment("c1", 100)],
      [
        event("e1", 100, { kind: "commented", detail: "body c1" }),
        event("e2", 200, { kind: "comment_deleted", detail: "gone" }),
      ],
    );
    assert.deepEqual(
      items.map((i) => i.key),
      ["event:e2", "comment:c1"],
    );
  });

  test("the same event from two sources appears once", () => {
    const items = mergeTimeline([], [event("e1", 100), event("e1", 100)]);
    assert.equal(items.length, 1);
  });

  test("empty in, empty out", () => {
    assert.deepEqual(mergeTimeline([], []), []);
  });
});

describe("adapters", () => {
  test("eventsFromActivity keeps kind, actor, detail and time", () => {
    const [e] = eventsFromActivity([
      row("r1", { kind: "updated", detail: "Due date → Oct 20", created_at: { toMillis: () => 42 } }),
    ]);
    assert.deepEqual(e, {
      id: "activity:r1",
      kind: "updated",
      actorId: "u2",
      actorName: "Casey Nolan",
      ms: 42,
      detail: "Due date → Oct 20",
    });
  });

  test("milestone rows: ticks and unticks only, titled, unknown milestones dropped", () => {
    const titles = new Map([["m1", "Pick a vendor"]]);
    const events = milestoneEventsFromActivity(
      [
        row("r1", { kind: "completed" }),
        row("r2", { kind: "reopened" }),
        row("r3", { kind: "updated" }),
        row("r4", { kind: "commented" }),
        row("r5", { kind: "completed", entity_id: "gone" }),
      ],
      titles,
    );
    assert.deepEqual(
      events.map((e) => [e.id, e.kind, e.subject]),
      [
        ["milestone:r1", "milestone_completed", "Pick a vendor"],
        ["milestone:r2", "milestone_reopened", "Pick a vendor"],
      ],
    );
  });

  test("status history: status label, note as detail, blank note → null", () => {
    const events = eventsFromStatusHistory(
      [
        {
          id: "s1",
          status: "off_track",
          comment: "Vendor slipped",
          user_id: "u3",
          created_at_ms: 500,
          author_name: "Steph Benes",
        },
        {
          id: "s2",
          status: "on_track",
          comment: "   ",
          user_id: null,
          created_at_ms: null,
          author_name: "—",
        },
      ],
      (s) => (s === "off_track" ? "Off Track" : "On Track"),
    );
    assert.equal(events[0].kind, "status_changed");
    assert.deepEqual(events[0].status, { value: "off_track", label: "Off Track" });
    assert.equal(events[0].detail, "Vendor slipped");
    assert.equal(events[0].actorId, "u3");
    assert.equal(events[0].ms, 500);
    assert.equal(events[1].detail, null);
    assert.equal(events[1].ms, null);
  });

  test("ids are namespaced by source so they never collide", () => {
    const merged = mergeTimeline(
      [],
      [
        ...eventsFromActivity([row("x", { kind: "updated" })]),
        ...milestoneEventsFromActivity([row("x")], new Map([["m1", "T"]])),
        ...eventsFromStatusHistory([
          { id: "x", status: "done", comment: null, user_id: "u", created_at_ms: 1, author_name: "A" },
        ]),
      ],
    );
    assert.equal(merged.length, 3);
  });
});

describe("event sentences", () => {
  test("created names the item type", () => {
    assert.equal(feedEventVerb(event("e", 1, { kind: "created" }), "rock"), "created this rock");
    assert.equal(feedEventVerb(event("e", 1, { kind: "created" }), "todo"), "created this to-do");
    assert.equal(feedEventVerb(event("e", 1, { kind: "created" }), "issue"), "created this issue");
    assert.equal(
      feedEventVerb(event("e", 1, { kind: "created" }), "headline"),
      "created this headline",
    );
  });

  test("status, milestone, owner and due events", () => {
    assert.equal(
      feedEventVerb(
        event("e", 1, { kind: "status_changed", status: { value: "done", label: "Done" } }),
        "rock",
      ),
      "set the status to Done",
    );
    assert.equal(feedEventVerb(event("e", 1, { kind: "status_changed" }), "rock"), "changed the status");
    assert.equal(
      feedEventVerb(event("e", 1, { kind: "milestone_completed", subject: "Pick a vendor" }), "rock"),
      "completed the milestone “Pick a vendor”",
    );
    assert.equal(
      feedEventVerb(event("e", 1, { kind: "milestone_reopened", subject: " " }), "rock"),
      "reopened the milestone",
    );
    assert.equal(feedEventVerb(event("e", 1, { kind: "owner_changed" }), "issue"), "changed the owner");
    assert.equal(feedEventVerb(event("e", 1, { kind: "due_changed" }), "rock"), "changed the due date");
    assert.equal(feedEventVerb(event("e", 1, { kind: "solved" }), "issue"), "solved it");
  });

  test("trace kinds fall through to the trace's own verbs", () => {
    assert.equal(feedEventVerb(event("e", 1, { kind: "completed" }), "todo"), "completed it");
    assert.equal(
      feedEventVerb(event("e", 1, { kind: "comment_deleted" }), "todo"),
      "deleted a comment",
    );
  });

  test("a caller's verb wins", () => {
    assert.equal(
      feedEventVerb(event("e", 1, { kind: "updated", verb: "moved it to Long-term" }), "issue"),
      "moved it to Long-term",
    );
  });

  test("the viewer reads as You; others by name; blank name → Someone", () => {
    const e = event("e", 1, { kind: "completed" });
    assert.deepEqual(feedEventSentence(e, "todo", "u2"), { actor: "You", text: "completed it" });
    assert.deepEqual(feedEventSentence(e, "todo", "u9"), {
      actor: "Casey Nolan",
      text: "completed it",
    });
    assert.equal(
      feedEventSentence({ ...e, actorId: null, actorName: " " }, "todo", "u9").actor,
      "Someone",
    );
  });

  test("a system sweep has no actor", () => {
    const archived = event("e", 1, { kind: "archived", actorId: SYSTEM_ACTOR_ID, actorName: "EOS" });
    assert.deepEqual(feedEventSentence(archived, "todo", "u1"), {
      actor: null,
      text: "Archived automatically",
    });
    const other = event("e", 1, { kind: "restored", actorId: SYSTEM_ACTOR_ID, actorName: "EOS" });
    assert.deepEqual(feedEventSentence(other, "todo", "u1"), {
      actor: null,
      text: "Restored it to Active",
    });
  });
});

describe("feedCountLabel", () => {
  test("counts comments and updates, singular and plural", () => {
    assert.equal(feedCountLabel([]), "");
    assert.equal(
      feedCountLabel(mergeTimeline([comment("c", 1)], [event("a", 2), event("b", 3)])),
      "1 comment · 2 updates",
    );
    assert.equal(feedCountLabel(mergeTimeline([comment("c", 1), comment("d", 1)], [])), "2 comments");
  });
});
