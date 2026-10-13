import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { eventsFromStatusHistory } from "@/lib/activity-feed";
import {
  STATUS_BAR,
  STATUS_LABELS,
  STATUSES,
  rockStatusDotClass,
  rockStatusLabel,
} from "./status";

describe("rockStatusLabel", () => {
  test("known statuses use STATUS_LABELS", () => {
    for (const s of STATUSES) assert.equal(rockStatusLabel(s), STATUS_LABELS[s]);
  });

  test("an unknown value reads as words, not a raw key", () => {
    assert.equal(rockStatusLabel("at_risk"), "At risk");
    assert.equal(rockStatusLabel("paused"), "Paused");
  });

  test("an empty value still makes a sentence", () => {
    assert.equal(rockStatusLabel(""), "Unknown");
    assert.equal(rockStatusLabel(" _ "), "Unknown");
  });
});

describe("rockStatusDotClass", () => {
  test("known statuses use the STATUS_BAR fill", () => {
    for (const s of STATUSES) assert.equal(rockStatusDotClass(s), STATUS_BAR[s]);
  });

  test("an unknown value falls back to the feed's neutral dot", () => {
    assert.equal(rockStatusDotClass("at_risk"), undefined);
    assert.equal(rockStatusDotClass(""), undefined);
  });
});

describe("rock status history → feed events", () => {
  test("labels each change and keeps the note", () => {
    const events = eventsFromStatusHistory(
      [
        {
          id: "s1",
          status: "off_track",
          comment: "  Vendor slipped  ",
          user_id: "u1",
          created_at_ms: 2_000,
          author_name: "Steph Benes",
        },
        {
          id: "s2",
          status: "legacy_value",
          comment: null,
          user_id: null,
          created_at_ms: null,
          author_name: "—",
        },
      ],
      rockStatusLabel,
    );
    assert.deepEqual(
      events.map((e) => [e.id, e.kind, e.status, e.detail]),
      [
        ["status:s1", "status_changed", { value: "off_track", label: "Off Track" }, "Vendor slipped"],
        ["status:s2", "status_changed", { value: "legacy_value", label: "Legacy value" }, null],
      ],
    );
  });
});
