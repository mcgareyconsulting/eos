import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AGENDA_TOOL_TYPES,
  availableToolsToAdd,
  clampSegmentToAgenda,
  defaultL10CondensedItems,
  defaultL10Items,
  firstAgendaSegment,
  formatAgendaDuration,
  isFirstAgendaSegment,
  isLastAgendaSegment,
  nextInAgenda,
  normalizeAgendaItems,
  prevInAgenda,
  resolveMeetingAgenda,
  totalAgendaSeconds,
  totalAgendaMinutes,
  agendaItemLabel,
} from "./agenda";
import { TOTAL_MEETING_SECONDS } from "./segments";

describe("default L10 agenda", () => {
  test("covers every active tool exactly once", () => {
    const items = defaultL10Items();
    assert.equal(items.length, AGENDA_TOOL_TYPES.length);
    const types = items.map((i) => i.type);
    assert.deepEqual(types, [...AGENDA_TOOL_TYPES]);
  });

  test("sums to the advertised 90-minute total", () => {
    assert.equal(totalAgendaSeconds(defaultL10Items()), TOTAL_MEETING_SECONDS);
    assert.equal(totalAgendaMinutes(defaultL10Items()), 90);
  });
});

describe("L10 Condensed", () => {
  test("sums to 60 minutes", () => {
    assert.equal(totalAgendaMinutes(defaultL10CondensedItems()), 60);
  });
});

describe("normalizeAgendaItems", () => {
  test("rejects empty / non-array", () => {
    assert.equal(normalizeAgendaItems(null), null);
    assert.equal(normalizeAgendaItems([]), null);
    assert.equal(normalizeAgendaItems("x"), null);
  });

  test("dedupes types (first wins) and drops done/unknown", () => {
    const items = normalizeAgendaItems([
      { type: "segue", duration_seconds: 300 },
      { type: "done", duration_seconds: 60 },
      { type: "segue", duration_seconds: 999 },
      { type: "issues", duration_seconds: 1800 },
      { type: "not-real", duration_seconds: 60 },
    ]);
    assert.deepEqual(
      items?.map((i) => [i.type, i.duration_seconds]),
      [
        ["segue", 300],
        ["issues", 1800],
      ],
    );
  });

  test("maps legacy ids → issues and clamps tiny durations", () => {
    const items = normalizeAgendaItems([
      { type: "ids", duration_seconds: 10 },
    ]);
    assert.equal(items?.[0]?.type, "issues");
    assert.ok((items?.[0]?.duration_seconds ?? 0) >= 60);
  });
});

describe("nextInAgenda / prevInAgenda", () => {
  const items = [
    { type: "scorecard" as const, duration_seconds: 300 },
    { type: "issues" as const, duration_seconds: 3600 },
    { type: "conclude" as const, duration_seconds: 300 },
  ];

  test("steps forward and clamps at last item (not done)", () => {
    assert.equal(nextInAgenda(items, "scorecard"), "issues");
    assert.equal(nextInAgenda(items, "issues"), "conclude");
    assert.equal(nextInAgenda(items, "conclude"), "conclude");
  });

  test("steps backward and clamps at first item", () => {
    assert.equal(prevInAgenda(items, "issues"), "scorecard");
    assert.equal(prevInAgenda(items, "scorecard"), "scorecard");
  });

  test("unknown current falls back to first", () => {
    assert.equal(nextInAgenda(items, "rocks"), "scorecard");
    assert.equal(prevInAgenda(items, "rocks"), "scorecard");
  });
});

describe("agenda edge helpers", () => {
  const items = defaultL10Items();

  test("first/last segment flags", () => {
    assert.equal(firstAgendaSegment(items), "segue");
    assert.equal(isFirstAgendaSegment(items, "segue"), true);
    assert.equal(isLastAgendaSegment(items, "conclude"), true);
    assert.equal(isLastAgendaSegment(items, "issues"), false);
  });

  test("clampSegmentToAgenda recovers from missing stages", () => {
    const short = [
      { type: "issues" as const, duration_seconds: 600 },
      { type: "conclude" as const, duration_seconds: 300 },
    ];
    assert.equal(clampSegmentToAgenda(short, "rocks"), "issues");
    assert.equal(clampSegmentToAgenda(short, "issues"), "issues");
  });

  test("availableToolsToAdd excludes used types", () => {
    const used = [{ type: "issues" as const, duration_seconds: 600 }];
    assert.ok(!availableToolsToAdd(used).includes("issues"));
    assert.ok(availableToolsToAdd(used).includes("segue"));
  });
});

describe("resolveMeetingAgenda", () => {
  test("falls back to Level 10 for legacy meetings", () => {
    const snap = resolveMeetingAgenda({});
    assert.equal(snap.agenda_name, "Level 10");
    assert.equal(snap.agenda_items.length, AGENDA_TOOL_TYPES.length);
  });

  test("preserves stored snapshot", () => {
    const snap = resolveMeetingAgenda({
      agenda_id: "abc",
      agenda_name: "Issues focus",
      agenda_items: [
        { type: "issues", duration_seconds: 2400 },
        { type: "conclude", duration_seconds: 300 },
      ],
    });
    assert.equal(snap.agenda_id, "abc");
    assert.equal(snap.agenda_name, "Issues focus");
    assert.equal(snap.agenda_items.length, 2);
  });
});

describe("labels and formatting", () => {
  test("custom label wins over default", () => {
    assert.equal(
      agendaItemLabel({ type: "issues", duration_seconds: 60, label: "IDS" }),
      "IDS",
    );
    assert.equal(
      agendaItemLabel({ type: "issues", duration_seconds: 60 }),
      "Issues",
    );
  });

  test("formatAgendaDuration", () => {
    assert.equal(formatAgendaDuration(300), "5 min");
    assert.equal(formatAgendaDuration(3600), "1 hr");
    assert.equal(formatAgendaDuration(5400), "1 hr 30 min");
  });
});
