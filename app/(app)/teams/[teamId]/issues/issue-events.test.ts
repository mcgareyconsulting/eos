import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { feedEventSentence } from "@/lib/activity-feed";
import {
  issueEventsFromDoc,
  issueTimeMs,
  type IssueEventSource,
} from "./issue-events";

const ts = (ms: number) => ({ toMillis: () => ms });
const NAMES: Record<string, string> = { u1: "Steph Benes", u2: "Casey Nolan" };
const nameOf = (uid: string) => NAMES[uid];

const issue = (over: Partial<IssueEventSource> = {}): IssueEventSource => ({
  id: "i1",
  status: "open",
  ...over,
});

describe("issueTimeMs", () => {
  test("reads Timestamps and numbers", () => {
    assert.equal(issueTimeMs(ts(1000)), 1000);
    assert.equal(issueTimeMs(2000), 2000);
  });

  test("anything else is no time", () => {
    assert.equal(issueTimeMs(null), null);
    assert.equal(issueTimeMs(undefined), null);
    // The L10 prefetch flattens archived_at to `true`.
    assert.equal(issueTimeMs(true), null);
    assert.equal(issueTimeMs("2026-01-01"), null);
    assert.equal(issueTimeMs(Number.NaN), null);
    assert.equal(issueTimeMs({}), null);
    assert.equal(issueTimeMs({ toMillis: () => Number.NaN }), null);
  });
});

describe("issueEventsFromDoc", () => {
  test("a server-rendered issue (no timestamps) has no events", () => {
    assert.deepEqual(issueEventsFromDoc(issue(), nameOf), []);
  });

  test("created names its creator", () => {
    const [e] = issueEventsFromDoc(
      issue({ created_at: ts(100), created_by: "u1" }),
      nameOf,
    );
    assert.deepEqual(e, {
      id: "issue:i1:created",
      kind: "created",
      actorId: "u1",
      actorName: "Steph Benes",
      ms: 100,
    });
    assert.deepEqual(feedEventSentence(e, "issue", "u2"), {
      actor: "Steph Benes",
      text: "created this issue",
    });
    assert.equal(feedEventSentence(e, "issue", "u1").actor, "You");
  });

  test("an imported issue (no created_by) reads as Someone", () => {
    const [e] = issueEventsFromDoc(issue({ created_at: ts(100) }), nameOf);
    assert.equal(e.actorId, null);
    assert.equal(feedEventSentence(e, "issue", "u2").actor, "Someone");
  });

  test("a creator off the roster reads as Someone", () => {
    const [e] = issueEventsFromDoc(
      issue({ created_at: ts(100), created_by: "gone" }),
      nameOf,
    );
    assert.equal(e.actorId, "gone");
    assert.equal(feedEventSentence(e, "issue", "u2").actor, "Someone");
  });

  test("solved names the solver while the stamp still matches", () => {
    const events = issueEventsFromDoc(
      issue({
        status: "solved",
        resolved_at: ts(500),
        updated_at: ts(500),
        updated_by: "u2",
      }),
      nameOf,
    );
    assert.deepEqual(events, [
      {
        id: "issue:i1:solved",
        kind: "solved",
        actorId: "u2",
        actorName: "Casey Nolan",
        ms: 500,
      },
    ]);
    assert.equal(feedEventSentence(events[0], "issue", "u1").text, "solved it");
  });

  test("a later write makes the solver unknown rather than wrong", () => {
    const [e] = issueEventsFromDoc(
      issue({
        status: "solved",
        resolved_at: ts(500),
        updated_at: ts(900),
        updated_by: "u1",
      }),
      nameOf,
    );
    assert.equal(e.actorId, null);
    assert.equal(feedEventSentence(e, "issue", "u1").actor, "Someone");
  });

  test("dropped says dropped", () => {
    const [e] = issueEventsFromDoc(
      issue({ status: "dropped", resolved_at: ts(500) }),
      nameOf,
    );
    assert.equal(e.id, "issue:i1:dropped");
    assert.equal(feedEventSentence(e, "issue", "u1").text, "dropped it");
  });

  test("a resolved_at left on an open issue is not a solve", () => {
    for (const status of ["open", "solving"] as const) {
      assert.deepEqual(
        issueEventsFromDoc(issue({ status, resolved_at: ts(500) }), nameOf),
        [],
      );
    }
  });

  test("archived, with the archiver when the stamp matches", () => {
    const events = issueEventsFromDoc(
      issue({
        status: "solved",
        resolved_at: ts(500),
        archived_at: ts(800),
        updated_at: ts(800),
        updated_by: "u1",
      }),
      nameOf,
    );
    assert.deepEqual(
      events.map((e) => [e.id, e.actorId, e.ms]),
      [
        // The archive moved the stamp on, so the solver is unknown.
        ["issue:i1:solved", null, 500],
        ["issue:i1:archived", "u1", 800],
      ],
    );
  });

  test("the Monday sweep (no stamp) archives with no named actor", () => {
    const [e] = issueEventsFromDoc(
      issue({
        status: "open",
        archived_at: ts(800),
        updated_at: ts(500),
        updated_by: "u1",
      }),
      nameOf,
    );
    assert.equal(e.kind, "archived");
    assert.equal(e.actorId, null);
  });

  test("a flattened archived_at (L10 prefetch) is left out", () => {
    assert.deepEqual(
      issueEventsFromDoc(issue({ archived_at: true }), nameOf),
      [],
    );
  });

  test("full lifecycle: one event per proven fact, ids distinct", () => {
    const events = issueEventsFromDoc(
      issue({
        created_at: ts(100),
        created_by: "u1",
        status: "dropped",
        resolved_at: ts(500),
        archived_at: ts(800),
      }),
      nameOf,
    );
    assert.deepEqual(
      events.map((e) => e.id),
      ["issue:i1:created", "issue:i1:dropped", "issue:i1:archived"],
    );
  });
});
