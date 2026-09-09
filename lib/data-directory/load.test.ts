import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { UNOWNED_FILTER_VALUE } from "./registry";
import { loadData, type DataFilters } from "./load";

function seedOrg() {
  const db = new FakeFirestore();
  db.seed("teams", "t1", { name: "Lending" });
  db.seed("teams", "t2", { name: "Ops" });
  db.seed("users", "u1", { display_name: "Ada Byron" });
  db.seed("users", "u2", { display_name: "Grace Hopper" });

  db.seed("rocks", "r1", {
    team_id: "t1",
    title: "Core migration",
    owner_id: "u1",
    status: "on_track",
    quarter: "2026 Q3",
  });
  db.seed("rocks", "r2", {
    team_id: "t2",
    title: "Branch refresh",
    owner_id: "u2",
    status: "off_track",
    quarter: "2026 Q4",
  });
  // Department rock: unowned on purpose, not missing data.
  db.seed("rocks", "r3", {
    team_id: "t1",
    title: "Company goal",
    owner_id: null,
    rock_type: "department",
    status: "on_track",
    quarter: "2026 Q3",
  });
  db.seed("todos", "d1", {
    team_id: "t1",
    title: "Private note",
    owner_id: "u1",
    visibility: "private",
  });
  db.seed("todos", "d2", {
    team_id: "t2",
    title: "Public task",
    owner_id: "u2",
    visibility: "team",
    archived_at: new Date("2026-08-01"),
  });
  db.seed("meetings", "m1", { team_id: "t1", started_at: new Date("2026-09-01") });
  db.seed("scorecard_metrics", "sm1", {
    team_id: "t2",
    name: "Deposits",
    owner_id: "u2",
    unit: "number",
  });
  db.seed("scorecard_entries", "se1", {
    metric_id: "sm1",
    week_start_date: "2026-09-07",
    value: 42,
  });
  return db;
}

const NO_FILTERS: DataFilters = {
  type: "all",
  teamId: null,
  ownerId: null,
  state: null,
  quarter: null,
  q: null,
};

const run = (db: FakeFirestore, over: Partial<DataFilters> = {}) =>
  loadData(db.asFirestore(), { ...NO_FILTERS, ...over });

describe("loadData", () => {
  test("with no filters, returns every row across every team", async () => {
    const data = await run(seedOrg());
    const ids = data.rows.map((r) => `${r.type}:${r.id}`);
    assert.ok(ids.includes("rocks:r1"));
    assert.ok(ids.includes("rocks:r2"));
    assert.ok(ids.includes("todos:d1"), "private to-dos are included");
    assert.ok(ids.includes("meetings:m1"));
    assert.ok(ids.includes("scorecard_entries:se1"));
  });

  test("team filter spans every type, including ones with no team_id field", async () => {
    const data = await run(seedOrg(), { teamId: "t2" });
    assert.deepEqual(
      [...new Set(data.rows.map((r) => r.teamId))],
      ["t2"],
      "no row from another team survives",
    );
    // scorecard_entries carry no team_id — they reach t2 through their metric.
    assert.ok(data.rows.some((r) => r.type === "scorecard_entries"));
  });

  test("a single type renders only that type", async () => {
    const data = await run(seedOrg(), { type: "rocks" });
    assert.equal(data.byType.length, 1);
    assert.equal(data.rows.length, 3);
  });

  test("owner filter matches the owner field, whatever it is called", async () => {
    const data = await run(seedOrg(), { ownerId: "u2" });
    assert.deepEqual(
      data.rows.map((r) => r.id).sort(),
      ["d2", "r2", "sm1"],
      "rocks, to-dos and measurables all resolve u2",
    );
  });

  test("the unowned filter finds department rocks and nothing else", async () => {
    const data = await run(seedOrg(), { ownerId: UNOWNED_FILTER_VALUE });
    assert.deepEqual(data.rows.map((r) => r.id), ["r3"]);
  });

  test("an owner filter drops types that have no owner concept", async () => {
    const data = await run(seedOrg(), { ownerId: "u1" });
    assert.ok(
      !data.rows.some((r) => r.type === "meetings"),
      "a meeting is not owned by anyone, so it cannot match an owner",
    );
  });

  test("state filter uses the normalized lifecycle", async () => {
    const data = await run(seedOrg(), { state: "archived" });
    assert.deepEqual(data.rows.map((r) => r.id), ["d2"]);
  });

  test("quarter filter narrows to rocks in that quarter", async () => {
    const data = await run(seedOrg(), { quarter: "2026 Q3" });
    assert.deepEqual(data.rows.map((r) => r.id).sort(), ["r1", "r3"]);
  });

  test("search matches title, team name and owner name", async () => {
    const db = seedOrg();
    assert.deepEqual((await run(db, { q: "core" })).rows.map((r) => r.id), ["r1"]);
    assert.ok(
      (await run(db, { q: "grace" })).rows.every((r) => r.owner === "Grace Hopper"),
    );
    assert.ok(
      (await run(db, { q: "lending" })).rows.every((r) => r.teamId === "t1"),
    );
  });

  test("filters compose", async () => {
    const data = await run(seedOrg(), { teamId: "t1", ownerId: "u1" });
    assert.deepEqual(data.rows.map((r) => r.id).sort(), ["d1", "r1"]);
  });

  test("facet options come from the whole org, not the filtered set", async () => {
    const data = await run(seedOrg(), { teamId: "t1" });
    assert.deepEqual(data.teams.map((t) => t.name), ["Lending", "Ops"]);
    assert.deepEqual(data.owners.map((o) => o.name), ["Ada Byron", "Grace Hopper"]);
  });

  test("names resolve, and an unresolvable owner id stays a dash", async () => {
    const db = seedOrg();
    db.seed("rocks", "r4", { team_id: "t1", title: "Orphan", owner_id: "gone" });
    const data = await run(db, { type: "rocks" });
    const orphan = data.rows.find((r) => r.id === "r4")!;
    assert.equal(orphan.owner, "—");
    assert.equal(data.ctx.teamName("t1"), "Lending");
  });
});
