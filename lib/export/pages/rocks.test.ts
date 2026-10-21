import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { viewerOf } from "@/lib/access/types";
import { mapFullRock, type FullRock } from "@/lib/rocks-view";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  adminExportDeps,
  auditRowsOf,
  exportDepsAs,
  ts,
} from "@/lib/test-support/export-deps";
import { runExport } from "../run";
import { isRefusal } from "../types";
import { exportUrl, teamListExportParams } from "../urls";
import {
  BLOCK_ENTRY,
  ROCKS_COLUMNS,
  milestoneLines,
  parseRocksParams,
  rocksViewRows,
  type RockBlockInput,
  type RockMilestone,
} from "./rocks";

function rock(id: string, over: Record<string, unknown> = {}): FullRock {
  return mapFullRock(id, {
    team_id: "t1",
    title: id,
    owner_id: "u1",
    quarter: "2026-Q4",
    due_date: null,
    status: "on_track",
    rock_type: "individual",
    ...over,
  });
}

const members = [
  { user_id: "u1", full_name: "Ada" },
  { user_id: "u2", full_name: "Grace" },
];
const names = new Map([
  ...members.map((m) => [m.user_id, m.full_name] as const),
  ["u7", "Off Roster"],
  ["u8", "Zed Outside"],
]);
const teamNames = new Map([
  ["t1", "Leadership"],
  ["t2", "Finance"],
]);
const admin = viewerOf("admin", true, [], []);
const outsider = viewerOf("u9", false, ["t3"], []);

function view(input: {
  own?: FullRock[];
  shared?: FullRock[];
  blocks?: RockBlockInput[];
  milestones?: Map<string, RockMilestone[]>;
  archived?: boolean;
  ownerFilter?: string;
  viewer?: typeof admin;
}) {
  return rocksViewRows({
    teamId: "t1",
    viewer: input.viewer ?? admin,
    archived: input.archived ?? false,
    ownerFilter: input.ownerFilter ?? "all",
    members,
    ownRocks: input.own ?? [],
    sharedRocks: input.shared ?? [],
    blocks: input.blocks ?? [],
    milestonesByRock: input.milestones ?? new Map(),
    nameOf: (id) => names.get(id),
    teamNameOf: (id) => teamNames.get(id),
  });
}

describe("rocks export — columns", () => {
  test("column snapshot (a change here changes every auditor file)", () => {
    assert.deepEqual(
      ROCKS_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["section", "Section", "text"],
        ["entry", "Entry", "text"],
        ["title", "Rock", "text"],
        ["description", "Description", "richtext"],
        ["owner", "Owner", "user"],
        ["status", "Status", "text"],
        ["rock_type", "Kind", "text"],
        ["is_company_rock", "Company", "boolean"],
        ["quarter", "Quarter", "text"],
        ["due_date", "Due", "date"],
        ["milestones", "Milestones", "text"],
        ["milestones_done", "Milestones done", "text"],
        ["from_team", "From team", "text"],
        ["audience_team_ids", "Shared with", "text"],
        ["private", "Private", "boolean"],
        ["archived_at", "Archived", "datetime"],
        ["assigned_by", "Assigned by", "user"],
        ["id", "Rock ID", "text"],
      ],
    );
  });

  test("milestones: a line each, in due order, with owner and state", () => {
    const text = milestoneLines(
      [
        { id: "b", title: "Draft", owner_id: "u2", due_date: "2026-11-01", completed: false },
        { id: "a", title: "Kickoff", owner_id: "u1", due_date: "2026-10-01", completed: true },
        { id: "c", title: "Someday", owner_id: null, due_date: null, completed: false },
      ],
      (id) => (id ? (names.get(id) ?? "—") : "Unassigned"),
    );
    assert.equal(
      text,
      "[done] Kickoff — Ada — due 2026-10-01\n[open] Draft — Grace — due 2026-11-01\n[open] Someday — Unassigned",
    );
  });
});

describe("rocks export — the page's view", () => {
  const own = [
    rock("ada-off", { status: "off_track" }),
    rock("ada-on"),
    rock("company", { is_company_rock: true, owner_id: "u2" }),
    rock("team", { rock_type: "department", owner_id: "u2" }),
    rock("shared-ownership", { owner_id: null }),
    rock("grace", { owner_id: "u2" }),
    rock("left-team", { owner_id: "u7" }),
    rock("archived", { archived_at: ts("2026-10-01T12:00:00Z") }),
  ];
  const shared = [
    // Owner on this roster → their own section.
    rock("finance-ada", { team_id: "t2", audience_team_ids: ["t1"], owner_id: "u1" }),
    // Owner elsewhere → "Shared by …" at the bottom.
    rock("finance-zed", { team_id: "t2", audience_team_ids: ["t1"], owner_id: "u8" }),
    // Archived on the parent: not shown here.
    rock("finance-old", {
      team_id: "t2",
      audience_team_ids: ["t1"],
      owner_id: "u8",
      archived_at: ts("2026-10-01T12:00:00Z"),
    }),
  ];
  const blocks: RockBlockInput[] = [
    {
      rock: { id: "ops-rock", title: "Ops rollout", owner_id: "u8", team_id: "t2" },
      memberId: "u2",
      milestones: [
        { id: "m1", title: "Train tellers", owner_id: "u2", due_date: null, completed: false },
      ],
    },
  ];

  test("Active: Company, Team, members A–Z (audience rocks + blocks under the person), off-roster owners, Shared by", () => {
    const rows = view({ own, shared, blocks });
    assert.deepEqual(
      rows.map((r) => [r.section, r.id]),
      [
        ["Company", "company"],
        ["Team", "team"],
        ["Team", "shared-ownership"],
        // Within a section: by status (On Track before Off Track).
        ["Ada", "ada-on"],
        ["Ada", "finance-ada"],
        ["Ada", "ada-off"],
        ["Grace", "grace"],
        // A block has no status, so it sorts after the person's rocks.
        ["Grace", "ops-rock"],
        ["Off Roster", "left-team"],
        ["Shared by Zed Outside", "finance-zed"],
      ],
    );
    const block = rows.find((r) => r.id === "ops-rock")!;
    assert.equal(block.entry, BLOCK_ENTRY);
    assert.equal(block.from_team, "Finance");
    assert.equal(block.milestones, "[open] Train tellers — Grace");
    assert.equal(rows.find((r) => r.id === "finance-ada")!.from_team, "Finance");
    assert.equal(rows.find((r) => r.id === "team")!.kind, "Team");
  });

  test("Archived: the team's own archived rocks only — no audience rocks, no blocks", () => {
    assert.deepEqual(
      view({ own, shared, blocks, archived: true }).map((r) => r.id),
      ["archived"],
    );
  });

  test("owner filter: that person's section, and their Shared by rocks", () => {
    assert.deepEqual(
      view({ own, shared, blocks, ownerFilter: "u2" }).map((r) => [r.section, r.id]),
      [
        ["Grace", "company"],
        ["Grace", "team"],
        ["Grace", "grace"],
        ["Grace", "ops-rock"],
      ],
    );
  });

  test("milestones ride their rock, with a done count", () => {
    const milestones = new Map([
      [
        "ada-on",
        [
          { id: "a", title: "One", owner_id: "u1", due_date: null, completed: true },
          { id: "b", title: "Two", owner_id: "u7", due_date: null, completed: false },
        ],
      ],
    ]);
    const row = view({ own, milestones }).find((r) => r.id === "ada-on")!;
    assert.equal(row.milestones_done, "1/2");
    assert.equal(row.milestones, "[done] One — Ada\n[open] Two — Off Roster");
  });

  test("never more than the page shows: rocks the viewer can't see stay out", () => {
    const rows = view({ own, shared, viewer: outsider });
    assert.deepEqual(rows, []);
  });

  test("params round-trip", () => {
    const params = teamListExportParams({ teamId: "t1", showArchived: false, ownerFilter: "u1" });
    const qs = new URL(exportUrl("rocks", params), "https://x").searchParams;
    assert.deepEqual(parseRocksParams(qs), { teamId: "t1", archived: false, owner: "u1" });
    assert.ok(isRefusal(parseRocksParams(new URLSearchParams("team="))));
  });
});

describe("rocks export — through the core", () => {
  function seed() {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("teams", "t2", { name: "Finance" });
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
    db.seed("team_members", "t2__u8", { team_id: "t2", user_id: "u8", role: "member" });
    db.seed("users", "u1", { display_name: "Ada Lovelace" });
    db.seed("users", "u8", { display_name: "Zed Outside" });
    db.seed("rocks", "r1", {
      team_id: "t1",
      title: "Open branch",
      owner_id: "u1",
      quarter: "2026-Q4",
      status: "on_track",
    });
    db.seed("todos", "m1", {
      team_id: "t1",
      title: "Lease",
      owner_id: "u8",
      source_rock_id: "r1",
      completed_at: null,
    });
    db.seed("rocks", "r2", {
      team_id: "t2",
      title: "Audit prep",
      owner_id: "u8",
      quarter: "2026-Q4",
      status: "off_track",
      audience_team_ids: ["t1"],
    });
    db.seed("rocks", "r3", { team_id: "t2", title: "Ops", owner_id: "u8", status: "on_track" });
    db.seed("todos", "m3", {
      team_id: "t2",
      title: "Train",
      owner_id: "u1",
      source_rock_id: "r3",
      completed_at: null,
      archived_at: null,
    });
    // Hidden: a private Finance rock that still lists t1 as an audience
    // (private clears the audience), and an ordinary Finance rock t1 has no
    // share in.
    db.seed("rocks", "r4", {
      team_id: "t2",
      title: "Secret plan",
      owner_id: "u8",
      quarter: "2026-Q4",
      status: "on_track",
      private: true,
      audience_team_ids: ["t1"],
    });
    db.seed("rocks", "r5", { team_id: "t2", title: "Finance only", owner_id: "u8", status: "on_track" });
    return db;
  }

  const EXPECTED = [
    ["Ada Lovelace", "Open branch", "Ada Lovelace", "[open] Lease — Zed Outside"],
    ["Ada Lovelace", "Ops", "Zed Outside", "[open] Train — Ada Lovelace"],
    ["Shared by Zed Outside", "Audit prep", "Zed Outside", ""],
  ];

  for (const who of [
    { label: "a member", deps: (db: FakeFirestore) => exportDepsAs(db, { uid: "u1" }) },
    { label: "an admin on no team", deps: (db: FakeFirestore) => adminExportDeps(db) },
  ]) {
    test(`${who.label}: own rocks, an audience rock and a block, milestones named, nothing hidden`, async () => {
      const db = seed();
      const res = await runExport("rocks", new URLSearchParams({ team: "t1" }), "csv", who.deps(db));
      assert.ok(res.ok);
      assert.deepEqual(res.table.headers, ROCKS_COLUMNS.map((c) => c.header));
      assert.deepEqual(
        res.table.rows.map((r) => [r[0], r[2], r[4], r[10]]),
        EXPECTED,
      );
      const flat = res.table.rows.flat();
      assert.ok(!flat.includes("Secret plan"));
      assert.ok(!flat.includes("Finance only"));
      assert.deepEqual(auditRowsOf(db).map((r) => r.outcome), ["ok"]);
    });
  }

  test("someone off the roster is refused before any rock is read", async () => {
    const db = seed();
    const res = await runExport(
      "rocks",
      new URLSearchParams({ team: "t1" }),
      "csv",
      exportDepsAs(db, { uid: "u8" }),
    );
    assert.equal(!res.ok && res.status, 404);
    assert.equal(!res.ok && res.reason, "no_page_access");
  });
});
