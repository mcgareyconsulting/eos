import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFeedbackItem } from "./model";
import { FEEDBACK_BOARD_COLUMNS, FEEDBACK_STATUSES, type FeedbackStatus } from "./types";
import {
  NO_FEEDBACK_FILTERS,
  describeFeedbackActivity,
  distinctFeedbackValues,
  feedbackStatusOptions,
  feedbackStatusSummary,
  feedbackTrackerHref,
  feedbackStatusCounts,
  feedbackDetailTerms,
  feedbackEyebrow,
  feedbackTitle,
  feedbackWording,
  filterFeedbackItems,
  formatFeedbackDate,
  groupFeedbackByColumn,
  sortFeedbackNewestFirst,
} from "./view";

function item(number: number, data: Record<string, unknown> = {}) {
  return readFeedbackItem(`fb-${String(number).padStart(3, "0")}`, {
    number,
    reported_on: "2026-08-12",
    reviewer: "Steph Benes",
    page: "Scorecard",
    type: "bug",
    original_comment: `comment ${number}`,
    status: "new",
    ...data,
  });
}

const ITEMS = [
  item(1, { status: "completed", page: "Rocks", summary: "Rock page is slow" }),
  item(2, { status: "answered", reviewer: "Jenna Scheeler" }),
  item(3, { status: "follow_up", client_resolution: "We will ask Jessica" }),
  item(4, { status: "building", page: "Rocks", reviewer: "Jenna Scheeler" }),
  item(5, { status: "postponed" }),
  item(6, { status: "deployed" }),
];

describe("filterFeedbackItems", () => {
  test("no filters keeps everything in order", () => {
    assert.deepEqual(
      filterFeedbackItems(ITEMS, NO_FEEDBACK_FILTERS).map((i) => i.number),
      [1, 2, 3, 4, 5, 6],
    );
  });

  test("statuses (any of), page and reviewer (exact) combine", () => {
    const f = { ...NO_FEEDBACK_FILTERS, statuses: new Set<FeedbackStatus>(["completed", "building"]) };
    assert.deepEqual(filterFeedbackItems(ITEMS, f).map((i) => i.number), [1, 4]);
    assert.deepEqual(filterFeedbackItems(ITEMS, { ...f, page: "Rocks", reviewer: "Jenna Scheeler" }).map((i) => i.number), [4]);
    assert.deepEqual(filterFeedbackItems(ITEMS, { ...NO_FEEDBACK_FILTERS, page: "Roc" }), []);
  });

  test("search is case-insensitive over label, summary, comment and resolutions", () => {
    const q = (query: string) =>
      filterFeedbackItems(ITEMS, { ...NO_FEEDBACK_FILTERS, query }).map((i) => i.number);
    assert.deepEqual(q("ROCK PAGE"), [1]);
    assert.deepEqual(q("fb-003"), [3]);
    assert.deepEqual(q("jessica"), [3]);
    assert.deepEqual(q("comment 5"), [5]);
    assert.deepEqual(q("  "), [1, 2, 3, 4, 5, 6]);
  });
});

describe("counts, values, sort", () => {
  test("feedbackStatusCounts has every status", () => {
    const c = feedbackStatusCounts(ITEMS);
    assert.deepEqual(Object.keys(c).sort(), [...FEEDBACK_STATUSES].sort());
    assert.equal(c.new, 0);
    assert.equal(c.completed, 1);
  });

  test("distinctFeedbackValues is sorted and de-duplicated", () => {
    assert.deepEqual(distinctFeedbackValues(ITEMS, "page"), ["Rocks", "Scorecard"]);
    assert.deepEqual(distinctFeedbackValues(ITEMS, "reviewer"), ["Jenna Scheeler", "Steph Benes"]);
  });

  test("sortFeedbackNewestFirst: date desc, then number desc", () => {
    const items = [item(1, { reported_on: "2026-07-30" }), item(2, { reported_on: "2026-09-02" }), item(3, { reported_on: "2026-09-02" })];
    assert.deepEqual(sortFeedbackNewestFirst(items).map((i) => i.number), [3, 2, 1]);
  });
});

describe("groupFeedbackByColumn", () => {
  test("six columns in order; Done holds Completed + Answered", () => {
    const groups = groupFeedbackByColumn(ITEMS);
    assert.deepEqual(
      groups.map((g) => g.column.label),
      ["New", "Building", "Deployed", "Follow-up", "Postponed", "Done"],
    );
    const by = Object.fromEntries(groups.map((g) => [g.column.id, g.items.map((i) => i.number)]));
    assert.deepEqual(by, { new: [], building: [4], deployed: [6], follow_up: [3], postponed: [5], done: [1, 2] });
    assert.equal(groups.length, FEEDBACK_BOARD_COLUMNS.length);
  });
});

describe("links and wording", () => {
  test("status options carry counts; summary reads the pick", () => {
    const opts = feedbackStatusOptions(feedbackStatusCounts(ITEMS));
    assert.deepEqual(opts.map((o) => o.value), [...FEEDBACK_STATUSES]);
    assert.equal(opts.find((o) => o.value === "completed")?.label, "Completed · 1");
    assert.equal(opts.find((o) => o.value === "new")?.label, "New · 0");
    assert.equal(feedbackStatusSummary(new Set()), "All statuses");
    assert.equal(feedbackStatusSummary(new Set<FeedbackStatus>(["follow_up"])), "Follow-up");
    assert.equal(feedbackStatusSummary(new Set<FeedbackStatus>(["new", "building", "deployed"])), "3 statuses");
  });

  test("feedbackTrackerHref keeps the view and the open item", () => {
    assert.equal(feedbackTrackerHref({ view: "list" }), "/admin/feedback");
    assert.equal(feedbackTrackerHref({ view: "board" }), "/admin/feedback?view=board");
    assert.equal(feedbackTrackerHref({ view: "list", item: "fb-037" }), "/admin/feedback?item=fb-037");
    assert.equal(feedbackTrackerHref({ view: "board", item: "fb-037" }), "/admin/feedback?view=board&item=fb-037");
    assert.equal(feedbackTrackerHref({ view: "board", item: null }), "/admin/feedback?view=board");
  });

  test("no GitHub URLs in the tracker helpers", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["lib/feedback/view.ts", "lib/feedback/edit.ts"]) {
      assert.doesNotMatch(readFileSync(f, "utf8"), /github\.com/i, f);
    }
  });

  test("formatFeedbackDate", () => {
    assert.equal(formatFeedbackDate("2026-10-07"), "Oct 7, 2026");
    // 03:00 UTC on Oct 8 is still Oct 7 in Denver.
    assert.equal(formatFeedbackDate("2026-10-08T03:00:00Z"), "Oct 7, 2026");
    assert.equal(formatFeedbackDate(null), "—");
    assert.equal(formatFeedbackDate("soon"), "soon");
  });

  test("describeFeedbackActivity", () => {
    const base = { id: "a", at: null, actor_uid: "u" };
    assert.equal(
      describeFeedbackActivity({ ...base, kind: "status", from: "building", to: "completed", fields: ["prs", "shipped_at"] }),
      "changed status Building → Completed; also edited PRs, shipped date",
    );
    assert.equal(describeFeedbackActivity({ ...base, kind: "edited", fields: ["resolution"] }), "edited internal resolution");
    assert.equal(describeFeedbackActivity({ ...base, kind: "created", to: "new" }), "logged this item");
    assert.equal(
      describeFeedbackActivity({ ...base, kind: "imported", to: "answered" }),
      "imported from the HPB feedback spreadsheet as Answered",
    );
  });
});

describe("the detail modal's pure helpers (design A)", () => {
  test("eyebrow: FB number, then page and type", () => {
    assert.deepEqual(feedbackEyebrow(item(36, { page: "Scorecard", type: "bug" })), {
      label: "FB-036",
      rest: ["Scorecard", "Bug"],
    });
    assert.deepEqual(feedbackEyebrow(item(7, { page: " ", type: "ux" })).rest, ["UX"]);
  });

  test("title: the summary, else '<page> feedback'", () => {
    assert.equal(feedbackTitle(item(1, { summary: "Slow rocks" })), "Slow rocks");
    assert.equal(feedbackTitle(item(2, { page: "Rocks" })), "Rocks feedback");
  });

  test("wording: the original shows only when the display text differs", () => {
    assert.deepEqual(feedbackWording(item(1, { original_comment: "teh bug" })), { text: "teh bug", original: null });
    assert.deepEqual(feedbackWording(item(2, { original_comment: "teh bug", comment_display: "The bug." })), {
      text: "The bug.",
      original: "teh bug",
    });
    assert.deepEqual(feedbackWording(item(3, { original_comment: "Same", comment_display: " Same " })).original, null);
  });

  test("details grid: follow up with, decision source, type; topic only when set; never internal fields", () => {
    const plain = feedbackDetailTerms(item(1, { type: "feature" }));
    assert.deepEqual(plain, [
      { label: "Follow up with", value: null },
      { label: "Decision source", value: null },
      { label: "Type", value: "Feature" },
    ]);
    const full = feedbackDetailTerms(
      item(2, {
        follow_up_with: "Steph/Jenna",
        decision_source: "Daniel, Sep 2",
        follow_up_topic: "links",
        resolution: "internal note",
        evidence: ["PR #40"],
      }),
    );
    assert.deepEqual(full.map((t) => t.label), ["Follow up with", "Decision source", "Type", "Follow-up topic"]);
    assert.ok(!JSON.stringify(full).includes("internal note"));
    assert.ok(!JSON.stringify(full).includes("PR #40"));
  });

  test("search no longer reaches the internal resolution note", () => {
    const items = [item(1, { resolution: "secret internal words" }), item(2, { client_resolution: "staff words" })];
    const q = (query: string) => filterFeedbackItems(items, { ...NO_FEEDBACK_FILTERS, query }).map((i) => i.number);
    assert.deepEqual(q("secret internal"), []);
    assert.deepEqual(q("staff words"), [2]);
  });
});
