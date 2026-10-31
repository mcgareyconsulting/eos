import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "./test-support/fake-firestore";
import { auditScorecards } from "./scorecard-audit";
import type { Point } from "./scorecard-diff";
import type { RepairMetric } from "./scorecard-share-repair";
import { applyDuplicateMerge, planDuplicateMerges } from "./scorecard-duplicate-merge";

const W1 = "2026-09-07";
const W2 = "2026-09-14";
const W3 = "2026-09-21";

type Seed = Partial<RepairMetric> & { id: string; team_id: string } & Record<string, unknown>;

function setup(metrics: Seed[], values: Record<string, Record<string, number | null>>, member: Record<string, string[]>) {
  const db = new FakeFirestore();
  for (const m of metrics) db.seed("scorecard_metrics", m.id, { name: "Loans Closed", owner_id: "katy", import_source: "csv", ...m });
  for (const [id, weeks] of Object.entries(values)) {
    for (const [week, value] of Object.entries(weeks)) {
      db.seed("scorecard_entries", `${id}__${week}`, { metric_id: id, week_start_date: week, value });
    }
  }
  const all: RepairMetric[] = db.docsIn("scorecard_metrics").map((d) => ({ id: d.id, ...(d.data as Omit<RepairMetric, "id">) }));
  const entries = new Map<string, Map<string, Point>>();
  for (const e of db.docsIn("scorecard_entries")) {
    const id = e.data.metric_id as string;
    entries.set(id, (entries.get(id) ?? new Map()).set(e.data.week_start_date as string, { value: e.data.value as number | null }));
  }
  const { rows } = auditScorecards({
    metrics: all,
    entries,
    memberships: new Map(Object.entries(member).map(([u, t]) => [u, new Set(t)])),
    nameOf: (u) => u,
  });
  return { db, rows, entries };
}

describe("planDuplicateMerges", () => {
  test("weeks only the duplicate has are filled onto the original", () => {
    const { rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1, [W2]: 2 }, tr: { [W1]: 1, [W3]: 3 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    assert.equal(plan.original.id, "esd");
    assert.equal(plan.status, "ready");
    assert.deepEqual([...plan.fill].map(([w, f]) => [w, f.value]), [[W3, 3]]);
  });

  test("different numbers for the same week hold the plan back, unless the original's win", () => {
    const { rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1 }, tr: { [W1]: 9 } },
      { katy: ["ESD"] },
    );
    assert.equal(planDuplicateMerges(rows, entries)[0].status, "differs");
    assert.equal(planDuplicateMerges(rows, entries, { keepOriginalNumbers: true })[0].status, "ready");
  });

  test("two duplicates filling the same missing week differently → fill conflict, even with the original winning", () => {
    const { rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }, { id: "ln", team_id: "LN" }],
      { esd: {}, tr: { [W1]: 4 }, ln: { [W1]: 5 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries, { keepOriginalNumbers: true });
    assert.equal(plan.status, "fill-conflict");
    assert.deepEqual(plan.fillConflicts, [W1]);
  });
});

describe("planDuplicateMerges — app-created duplicates", () => {
  test("a duplicate made in the app is held back unless asked for", () => {
    const { rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR", import_source: null }],
      { esd: { [W1]: 1 }, tr: { [W1]: 1 } },
      { katy: ["ESD"] },
    );
    assert.equal(planDuplicateMerges(rows, entries)[0].status, "app-created");
    assert.equal(planDuplicateMerges(rows, entries, { includeAppCreated: true })[0].status, "ready");
  });
});

describe("planDuplicateMerges — different measurables under a loose name match", () => {
  test("names that only match loosely, or a different unit or interval, are held back", () => {
    for (const [dup, expect] of [
      [{ name: "NPS %" }, /name/],
      [{ unit: "currency" }, /unit/],
      [{ interval: "monthly" }, /interval/],
    ] as const) {
      const { rows, entries } = setup(
        [{ id: "esd", team_id: "ESD", name: "NPS", unit: "number" }, { id: "tr", team_id: "TR", ...{ name: "NPS", unit: "number" as string | null, interval: null as string | null }, ...dup }],
        {},
        { katy: ["ESD"] },
      );
      const [plan] = planDuplicateMerges(rows, entries, { keepOriginalNumbers: true, includeAppCreated: true });
      assert.equal(plan.status, "mismatch");
      assert.match(plan.mismatches.join(), expect);
    }
  });

  test("case and spacing alone are the same name", () => {
    const { rows, entries } = setup(
      [{ id: "esd", team_id: "ESD", name: "Loans  Closed" }, { id: "tr", team_id: "TR", name: "loans closed" }],
      {},
      { katy: ["ESD"] },
    );
    assert.equal(planDuplicateMerges(rows, entries)[0].status, "ready");
  });
});

describe("applyDuplicateMerge", () => {
  test("one record left: original shared to the duplicate's team and its trackers, duplicate and its values gone", async () => {
    const { db, rows, entries } = setup(
      [
        { id: "esd", team_id: "ESD", group: "Data", is_public: false, follower_ids: ["boss"] },
        {
          id: "tr",
          team_id: "TR",
          group: "Lending",
          follower_ids: ["peer"],
          is_public: true,
          shared_team_ids: ["RETAIL"],
          shared_groups: { RETAIL: "Ops" },
        },
      ],
      { esd: { [W1]: 1 }, tr: { [W1]: 1, [W2]: 2 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.deepEqual(result.problems, []);
    assert.ok(result.ok);

    const original = db.raw("scorecard_metrics/esd")!;
    assert.equal(original.owner_id, "katy");
    assert.equal(original.team_id, "ESD");
    assert.equal(original.group, "Data");
    assert.equal(original.is_public, true);
    assert.deepEqual(original.shared_team_ids, ["TR", "RETAIL"]);
    assert.deepEqual(original.shared_groups, { TR: "Lending", RETAIL: "Ops" });
    assert.deepEqual(original.follower_ids, ["boss", "peer"]);
    assert.equal(original.updated_by, "admin-uid");

    assert.equal(db.raw("scorecard_metrics/tr"), undefined);
    assert.equal(db.docsIn("scorecard_entries").filter((e) => e.data.metric_id === "tr").length, 0);
    assert.deepEqual(
      db.docsIn("scorecard_entries").filter((e) => e.data.metric_id === "esd").map((e) => [e.data.week_start_date, e.data.value]).sort(),
      [[W1, 1], [W2, 2]],
    );
    // Went public, and two teams started tracking: three access changes.
    assert.deepEqual(
      db.docsIn("audit_log").map((e) => e.data.change_kind).sort(),
      ["metric_public", "track", "track"],
    );
  });

  test("a week filled on the original after the plan, disagreeing with the duplicate, refuses the merge", async () => {
    const { db, rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1 }, tr: { [W1]: 1, [W2]: 2 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    db.seed("scorecard_entries", `esd__${W2}`, { metric_id: "esd", week_start_date: W2, value: 7 });
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.equal(result.ok, false);
    assert.match(result.problems.join(), /now differ on 2026-09-14/);
    assert.equal(db.raw(`scorecard_entries/esd__${W2}`)?.value, 7);
    assert.ok(db.raw("scorecard_metrics/tr"), "nothing deleted");
  });

  test("a number entered on the duplicate after the plan is copied over, not lost", async () => {
    const { db, rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1 }, tr: { [W1]: 1 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    db.seed("scorecard_entries", `tr__${W3}`, { metric_id: "tr", week_start_date: W3, value: 8 });
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.ok(result.ok, result.problems.join());
    assert.equal(db.raw(`scorecard_entries/esd__${W3}`)?.value, 8);
  });

  test("a number entered on the duplicate after the plan that disagrees refuses the merge", async () => {
    const { db, rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1 }, tr: {} },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    db.seed("scorecard_entries", `tr__${W1}`, { metric_id: "tr", week_start_date: W1, value: 5 });
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.equal(result.ok, false);
    assert.ok(db.raw("scorecard_metrics/tr"), "nothing deleted");
  });

  test("a same-team duplicate with no trackers doesn't make a private original public", async () => {
    const { db, rows, entries } = setup(
      [{ id: "a", team_id: "ESD", is_public: false }, { id: "b", team_id: "ESD" }],
      { a: { [W1]: 1 }, b: { [W1]: 1 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.ok(result.ok, result.problems.join());
    const kept = db.raw(`scorecard_metrics/${plan.original.id}`)!;
    assert.equal(kept.is_public, false);
    assert.equal(db.docsIn("scorecard_metrics").length, 1);
  });

  test("a stale section key for a team not yet tracking is replaced by the duplicate's section", async () => {
    const { db, rows, entries } = setup(
      [{ id: "esd", team_id: "ESD", shared_groups: { TR: "Old" } }, { id: "tr", team_id: "TR", group: "Lending" }],
      { esd: { [W1]: 1 }, tr: { [W1]: 1 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    assert.ok((await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid")).ok);
    assert.deepEqual(db.raw("scorecard_metrics/esd")?.shared_groups, { TR: "Lending" });
  });

  test("refuses when the duplicate's owner changed since the plan", async () => {
    const { db, rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1 }, tr: { [W1]: 1 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    await db.asFirestore().collection("scorecard_metrics").doc("tr").update({ owner_id: "someone-else" });
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.equal(result.ok, false);
    assert.match(result.problems.join(), /different owner/);
    assert.ok(db.raw("scorecard_metrics/tr"), "nothing deleted");
  });

  test("a plan that isn't ready is never applied", async () => {
    const { db, rows, entries } = setup(
      [{ id: "esd", team_id: "ESD" }, { id: "tr", team_id: "TR" }],
      { esd: { [W1]: 1 }, tr: { [W1]: 9 } },
      { katy: ["ESD"] },
    );
    const [plan] = planDuplicateMerges(rows, entries);
    const result = await applyDuplicateMerge(db.asFirestore(), plan, "admin-uid");
    assert.equal(result.ok, false);
    assert.ok(db.raw("scorecard_metrics/tr"));
  });
});
