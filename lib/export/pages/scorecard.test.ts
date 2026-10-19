import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ScorecardGroup } from "@/lib/scorecard-groups";
import { buildScorecardColumns, periodStartFor } from "@/lib/scorecard-periods";
import { DEFAULT_SCORECARD_TOOLBAR, type ScorecardToolbar } from "@/lib/scorecard-view";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { adminExportDeps, auditRowsOf, exportDepsAs } from "@/lib/test-support/export-deps";
import { runExport } from "../run";
import { isRefusal } from "../types";
import { exportUrl, scorecardExportParams } from "../urls";
import {
  SCORECARD_COLUMNS,
  goalText,
  parseScorecardParams,
  scorecardColumnsFor,
  scorecardViewRows,
  type ScorecardExportMetric,
} from "./scorecard";

const FROM = new Date(2026, 9, 14); // Wed 14 Oct 2026, local
const weekly = buildScorecardColumns("weekly", undefined, 8, FROM);

function metric(id: string, over: Partial<ScorecardExportMetric> = {}): ScorecardExportMetric {
  return {
    id,
    name: id,
    unit: "number",
    goal: 10,
    direction: "gte",
    owner_id: "u1",
    group: null,
    interval: "weekly",
    sectionName: "Weekly",
    sort_order: 0,
    team_id: "t1",
    sharedFrom: null,
    ...over,
  };
}

const members = [
  { user_id: "u1", full_name: "Ada" },
  { user_id: "u2", full_name: "Grace" },
];
const groups: ScorecardGroup[] = [
  { id: "g1", team_id: "t1", name: "Compliance", interval: "weekly", sort_order: 0 } as ScorecardGroup,
];

function view(
  metrics: ScorecardExportMetric[],
  entries: Record<string, number | null> = {},
  toolbar: Partial<ScorecardToolbar> = {},
  viewerId = "admin",
) {
  return scorecardViewRows({
    metrics,
    period: "weekly",
    columns: weekly,
    entries,
    toolbar: { ...DEFAULT_SCORECARD_TOOLBAR, ...toolbar },
    groups,
    members,
    viewerId,
  });
}

describe("scorecard export — columns", () => {
  test("column snapshot: the fixed columns, then one per period (newest first)", () => {
    assert.deepEqual(
      SCORECARD_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["section", "Group", "text"],
        ["name", "Measurable", "text"],
        ["owner", "Owner", "user"],
        ["goal", "Goal", "text"],
        ["unit", "Unit", "text"],
        ["status", "Status", "text"],
        ["average", "Average", "number"],
        ["shared_from", "Tracked from", "text"],
        ["id", "Measurable ID", "text"],
      ],
    );
    const cols = scorecardColumnsFor(weekly);
    assert.equal(cols.length, SCORECARD_COLUMNS.length + 8);
    const first = cols[SCORECARD_COLUMNS.length];
    assert.deepEqual([first.key, first.header, first.kind], [
      `period:${weekly[0].id}`,
      weekly[0].label,
      "number",
    ]);
    assert.equal(weekly[0].id, "2026-10-12", "newest week first");
  });

  test("goal reads in words, never as a formula-looking '= 5'", () => {
    assert.equal(goalText(5, "eq"), "Exactly 5");
    assert.equal(goalText(90, "gte"), "At least 90");
    assert.equal(goalText(2, "lte"), "At most 2");
    assert.equal(goalText(null, "gte"), "No goal");
  });

  test("period cells hold the stored numbers, status and average from them", () => {
    const [row] = view([metric("m")], {
      [`m__${weekly[0].id}`]: 12,
      [`m__${weekly[1].id}`]: 4,
    });
    const cols = scorecardColumnsFor(weekly);
    const cell = (key: string) => cols.find((c) => c.key === key)!.value(row);
    assert.equal(cell(`period:${weekly[0].id}`), 12);
    assert.equal(cell(`period:${weekly[2].id}`), null);
    assert.equal(cell("average"), 8);
    assert.equal(cell("status"), "At-risk");
  });
});

describe("scorecard export — the page's view", () => {
  const all = [
    metric("b-weekly", { sort_order: 2 }),
    metric("a-weekly", { sort_order: 1 }),
    metric("compliance", { group: "Compliance", sectionName: "Compliance", owner_id: "u2" }),
    metric("free-label", { group: "Zeta", sectionName: "Zeta" }),
    metric("monthly", { interval: "monthly", sectionName: "Monthly" }),
  ];

  test("Default order: the cadence default first, then defined groups, then free labels; sort_order within", () => {
    assert.deepEqual(
      view(all).map((r) => [r.section, r.id]),
      [
        ["Weekly", "a-weekly"],
        ["Weekly", "b-weekly"],
        ["Compliance", "compliance"],
        ["Zeta", "free-label"],
      ],
    );
  });

  test("the viewer's own measurables lead within their group", () => {
    assert.deepEqual(
      view(all, {}, {}, "u2").map((r) => r.id),
      ["a-weekly", "b-weekly", "compliance", "free-label"],
    );
    const mixed = [metric("x", { sort_order: 1 }), metric("y", { sort_order: 2, owner_id: "u2" })];
    assert.deepEqual(view(mixed, {}, {}, "u2").map((r) => r.id), ["y", "x"]);
  });

  test("a status filter flattens the list and keeps only that status", () => {
    const entries = { [`a-weekly__${weekly[0].id}`]: 1, [`compliance__${weekly[0].id}`]: 50 };
    const rows = view(all, entries, { status: "off" });
    assert.deepEqual(rows.map((r) => [r.section, r.id]), [["", "a-weekly"]]);
  });

  test("owner and group filters subset without flattening; search matches owner names", () => {
    assert.deepEqual(view(all, {}, { ownerId: "u2" }).map((r) => r.id), ["compliance"]);
    assert.deepEqual(view(all, {}, { group: "Zeta" }).map((r) => [r.section, r.id]), [
      ["Zeta", "free-label"],
    ]);
    assert.deepEqual(view(all, {}, { search: "grace" }).map((r) => r.id), ["compliance"]);
  });

  test("sort by name flattens nothing; by owner flattens", () => {
    assert.deepEqual(view(all, {}, { sort: "name" }).map((r) => r.section), [
      "Weekly",
      "Weekly",
      "Compliance",
      "Zeta",
    ]);
    assert.ok(view(all, {}, { sort: "owner" }).every((r) => r.section === ""));
  });

  test("params: URL state plus toolbar, round-tripped; junk falls back to defaults", () => {
    const params = scorecardExportParams({
      teamId: "t1",
      period: "monthly",
      weeks: 13,
      showArchived: true,
      status: "off",
      ownerId: "u2",
      group: "Compliance",
      sort: "average-desc",
      search: " loans ",
    });
    const qs = new URL(exportUrl("scorecard", params), "https://x").searchParams;
    assert.deepEqual(parseScorecardParams(qs), {
      teamId: "t1",
      period: "monthly",
      weeks: 13,
      archived: true,
      toolbar: {
        status: "off",
        ownerId: "u2",
        group: "Compliance",
        sort: "average-desc",
        search: "loans",
      },
    });
    const junk = parseScorecardParams(
      new URLSearchParams("team=t1&period=hourly&weeks=99&status=bad&sort=evil&archived=true"),
    );
    assert.ok(!isRefusal(junk));
    assert.deepEqual(junk, {
      teamId: "t1",
      period: "weekly",
      weeks: 13,
      // The scorecard page reads only `archived=1`.
      archived: false,
      toolbar: DEFAULT_SCORECARD_TOOLBAR,
    });
  });
});

describe("scorecard export — through the core", () => {
  function seed() {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("teams", "t2", { name: "Finance" });
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
    db.seed("team_members", "t2__u8", { team_id: "t2", user_id: "u8", role: "member" });
    db.seed("users", "u1", { display_name: "Ada Lovelace" });
    db.seed("users", "u8", { display_name: "Zed Outside" });
    db.seed("scorecard_metrics", "own", {
      team_id: "t1",
      name: "Loans closed",
      unit: "number",
      goal: 5,
      direction: "gte",
      owner_id: "u1",
      sort_order: 0,
    });
    db.seed("scorecard_metrics", "borrowed", {
      team_id: "t2",
      name: "@deposits",
      unit: "currency",
      goal: null,
      direction: "gte",
      owner_id: "u8",
      sort_order: 1,
      is_public: true,
      shared_team_ids: ["t1"],
    });
    db.seed("scorecard_metrics", "gone", {
      team_id: "t1",
      name: "Archived one",
      unit: "number",
      direction: "gte",
      sort_order: 2,
      archived_at: 1,
    });
    const thisWeek = periodStartFor("weekly");
    db.seed("scorecard_entries", "e1", { metric_id: "own", week_start_date: thisWeek, value: 7 });
    db.seed("scorecard_entries", "old", { metric_id: "own", week_start_date: "2020-01-06", value: 1 });
    // Hidden: a Finance measurable not shared with Leadership.
    db.seed("scorecard_metrics", "finance-only", {
      team_id: "t2",
      name: "Finance private KPI",
      unit: "number",
      goal: 1,
      direction: "gte",
      owner_id: "u8",
      sort_order: 3,
    });
    return db;
  }

  for (const who of [
    { label: "a member", deps: (db: FakeFirestore) => exportDepsAs(db, { uid: "u1" }) },
    { label: "an admin on no team", deps: (db: FakeFirestore) => adminExportDeps(db) },
  ]) {
    test(`${who.label}: own and tracked measurables, period columns and values, nothing hidden`, async () => {
      const db = seed();
      const res = await runExport(
        "scorecard",
        new URLSearchParams({ team: "t1", weeks: "8" }),
        "csv",
        who.deps(db),
      );
      assert.ok(res.ok);
      const t = res.table;
      // The fixed columns, then one per week the grid shows.
      assert.equal(t.headers.length, SCORECARD_COLUMNS.length + 8);
      assert.deepEqual(
        t.headers.slice(0, SCORECARD_COLUMNS.length),
        SCORECARD_COLUMNS.map((c) => c.header),
      );
      assert.deepEqual(
        t.headers.slice(SCORECARD_COLUMNS.length),
        buildScorecardColumns("weekly", undefined, 8).map((c) => c.label),
      );
      assert.deepEqual(
        t.rows.map((r) => r.slice(0, 8)),
        [
          ["Weekly", "Loans closed", "Ada Lovelace", "At least 5", "Number", "On-track", 7, ""],
          ["Weekly", "@deposits", "Zed Outside", "No goal", "Currency", "No data", "", "Finance"],
        ],
      );
      assert.equal(t.rows[0][SCORECARD_COLUMNS.length], 7, "this week's value in the newest column");
      assert.ok(!t.rows.flat().includes("Finance private KPI"));
      const audit = auditRowsOf(db);
      assert.equal(audit.length, 1);
      const filters = (audit[0].export as { filters: Record<string, string> }).filters;
      assert.equal(filters.Period, "Weekly");
      assert.equal(filters.Weeks, "8");
      assert.equal(filters.Status, "All statuses");
    });
  }

  test("someone off the roster is refused before any measurable is read", async () => {
    const db = seed();
    const res = await runExport(
      "scorecard",
      new URLSearchParams({ team: "t1" }),
      "csv",
      exportDepsAs(db, { uid: "u8" }),
    );
    assert.equal(!res.ok && res.status, 404);
    assert.equal(!res.ok && res.reason, "no_page_access");
  });
});
