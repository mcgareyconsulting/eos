import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { feedEventSentence, mergeTimeline } from "@/lib/activity-feed";
import {
  headlineActions,
  headlineAudienceLabel,
  headlineDetailFrom,
  headlineFeedEvents,
  type HeadlineDetailData,
  type HeadlineSource,
} from "./headline-detail";

const ts = (ms: number) => ({ toMillis: () => ms });

const source = (over: Partial<HeadlineSource> = {}): HeadlineSource => ({
  id: "h1",
  title: "Won the Acme account",
  body: "Signed Friday.",
  kind: "customer",
  created_by: "u1",
  created_at: ts(1_000),
  discussed: false,
  discussed_at: null,
  archived_at: null,
  broadcast: false,
  from_label: null,
  source_owner_name: null,
  ...over,
});

const detail = (over: Partial<HeadlineSource> = {}): HeadlineDetailData => {
  const s = source(over);
  return headlineDetailFrom(s, { body: s.body ?? null, ownerLabel: "Ann" });
};

const names: Record<string, string> = { u1: "Ann Lee", u2: "Bo Park" };
const nameOf = (uid: string) => names[uid];

describe("headlineDetailFrom", () => {
  test("reads Timestamps and millis alike", () => {
    const a = detail({ created_at: ts(5), archived_at: ts(9) });
    const b = detail({ created_at: 5, archived_at: 9 });
    assert.equal(a.createdMs, 5);
    assert.equal(a.archivedMs, 9);
    assert.deepEqual(a, b);
  });

  test("an empty body is null", () => {
    assert.equal(detail({ body: "  " }).body, null);
    assert.equal(detail({ body: null }).body, null);
    assert.equal(detail().body, "Signed Friday.");
  });

  test("discussed_at only counts while discussed", () => {
    assert.equal(detail({ discussed: true, discussed_at: 7 }).discussedMs, 7);
    assert.equal(detail({ discussed: false, discussed_at: 7 }).discussedMs, null);
  });

  test("missing optional fields read as empty", () => {
    const d = headlineDetailFrom(
      { id: "h2", title: "T", kind: "general" },
      { body: null, ownerLabel: "—" },
    );
    assert.equal(d.createdBy, null);
    assert.equal(d.createdMs, null);
    assert.equal(d.archivedMs, null);
    assert.equal(d.broadcast, false);
    assert.equal(d.fromLabel, null);
  });
});

describe("headlineAudienceLabel", () => {
  test("org-wide names its source when known", () => {
    assert.equal(
      headlineAudienceLabel({ broadcast: true, kind: "cascading", fromLabel: "CEO" }),
      "Org-wide · from CEO",
    );
    assert.equal(
      headlineAudienceLabel({ broadcast: true, kind: "general", fromLabel: null }),
      "Org-wide",
    );
  });

  test("a team's own cascading headline vs everything else", () => {
    assert.equal(
      headlineAudienceLabel({ broadcast: false, kind: "cascading", fromLabel: null }),
      "Cascading · this team's message",
    );
    assert.equal(
      headlineAudienceLabel({ broadcast: false, kind: "employee", fromLabel: null }),
      "This team",
    );
  });
});

describe("headlineFeedEvents", () => {
  test("a fresh headline has only its created event, by its creator", () => {
    const events = headlineFeedEvents(detail(), nameOf);
    assert.equal(events.length, 1);
    const [e] = events;
    assert.equal(e.kind, "created");
    assert.equal(e.actorId, "u1");
    assert.equal(e.actorName, "Ann Lee");
    assert.equal(e.ms, 1_000);
    assert.deepEqual(feedEventSentence(e, "headline", "u2"), {
      actor: "Ann Lee",
      text: "created this headline",
    });
    assert.equal(feedEventSentence(e, "headline", "u1").actor, "You");
  });

  test("no created event without a time — never sorted in as brand new", () => {
    assert.deepEqual(headlineFeedEvents(detail({ created_at: null }), nameOf), []);
  });

  test("an imported headline with no matched person uses the imported name", () => {
    const [e] = headlineFeedEvents(
      detail({ created_by: null, source_owner_name: "Pat Imported" }),
      nameOf,
    );
    assert.equal(e.actorId, null);
    assert.equal(e.actorName, "Pat Imported");
  });

  test("an unknown creator falls back to the feed's 'Someone'", () => {
    const [e] = headlineFeedEvents(detail({ created_by: "gone" }), nameOf);
    assert.equal(e.actorName, "");
    assert.equal(feedEventSentence(e, "headline", "u1").actor, "Someone");
    // The roster's "—" placeholder is not a name either.
    const [p] = headlineFeedEvents(detail({ created_by: "u9" }), () => "—");
    assert.equal(feedEventSentence(p, "headline", "u1").actor, "Someone");
  });

  test("discussed and archived carry no actor and read as bare sentences", () => {
    const events = headlineFeedEvents(
      detail({ discussed: true, discussed_at: 2_000, archived_at: 3_000 }),
      nameOf,
    );
    assert.deepEqual(
      events.map((e) => e.kind),
      ["created", "completed", "archived"],
    );
    const [, discussed, archived] = events;
    assert.deepEqual(feedEventSentence(discussed, "headline", "u1"), {
      actor: null,
      text: "Marked discussed",
    });
    // Not the sweep's "Archived automatically": a person may have done it.
    assert.deepEqual(feedEventSentence(archived, "headline", "u1"), {
      actor: null,
      text: "Archived",
    });
  });

  test("discussed without a time, or undiscussed, adds nothing", () => {
    assert.equal(
      headlineFeedEvents(detail({ discussed: true, discussed_at: null }), nameOf).length,
      1,
    );
    assert.equal(
      headlineFeedEvents(detail({ discussed: false, discussed_at: 2_000 }), nameOf).length,
      1,
    );
  });

  test("ids are unique per headline and merge newest first", () => {
    const events = headlineFeedEvents(
      detail({ discussed: true, discussed_at: 2_000, archived_at: 3_000 }),
      nameOf,
    );
    assert.equal(new Set(events.map((e) => e.id)).size, events.length);
    const order = mergeTimeline([], events).map((i) => i.ms);
    assert.deepEqual(order, [3_000, 2_000, 1_000]);
  });
});

describe("headlineActions", () => {
  const own = { broadcast: false, archivedMs: null };
  const ownArchived = { broadcast: false, archivedMs: 5 };
  const copy = { broadcast: true, archivedMs: null };

  test("Headlines tab mirrors its row", () => {
    assert.deepEqual(headlineActions(own, "page"), {
      discussed: true,
      edit: true,
      archive: true,
      delete: true,
    });
    assert.deepEqual(headlineActions(ownArchived, "page"), {
      discussed: false,
      edit: true,
      archive: true,
      delete: false,
    });
    assert.deepEqual(headlineActions(copy, "page"), {
      discussed: true,
      edit: false,
      archive: true,
      delete: false,
    });
  });

  test("L10 mirrors the segment row: no archive, text read-only on copies", () => {
    assert.deepEqual(headlineActions(own, "meeting"), {
      discussed: true,
      edit: true,
      archive: false,
      delete: true,
    });
    assert.deepEqual(headlineActions(copy, "meeting"), {
      discussed: true,
      edit: false,
      archive: false,
      delete: false,
    });
  });
});
