import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { groupByParent, importedOwnerOf, planShareRepairs, type RepairMetric } from "./scorecard-share-repair";

const names: Record<string, string> = { pat: "Pat Lee", sam: "Sam Ortiz" };
const nameOf = (uid: string) => names[uid] ?? uid;

const metric = (m: Partial<RepairMetric> & { id: string; team_id: string }): RepairMetric => ({
  name: "Loans Closed",
  owner_id: null,
  ...m,
});

const weeks = (...pairs: [string, number | null][]) => new Map(pairs);

describe("planShareRepairs", () => {
  const unowned = metric({ id: "u", team_id: "transformation", description: "Monthly.\n\nImported owner: Pat Lee", group: "Lending" });
  const patsOwn = metric({ id: "p", team_id: "esd", owner_id: "pat" });

  test("reads the imported owner note", () => {
    assert.equal(importedOwnerOf(unowned.description), "Pat Lee");
    assert.equal(importedOwnerOf("no note"), null);
  });

  test("same name, same owner, same numbers → share", () => {
    const [plan] = planShareRepairs([unowned, patsOwn], new Map([
      ["u", weeks(["2026-10-05", 4], ["2026-10-12", 7])],
      ["p", weeks(["2026-10-05", 4], ["2026-10-12", 7], ["2026-10-19", 2])],
    ]), nameOf);
    assert.equal(plan.status, "repair");
    assert.equal(plan.match?.id, "p");
    assert.equal(plan.weeksCompared, 2);
  });

  test("numbers that disagree are left for a person to check", () => {
    const [plan] = planShareRepairs([unowned, patsOwn], new Map([
      ["u", weeks(["2026-10-05", 4])],
      ["p", weeks(["2026-10-05", 5])],
    ]), nameOf);
    assert.equal(plan.status, "values-differ");
    assert.deepEqual(plan.weeksDiffering, ["2026-10-05"]);
  });

  test("a same-named measurable owned by someone else is not a match", () => {
    const samsOwn = metric({ id: "s", team_id: "retail", owner_id: "sam" });
    const [plan] = planShareRepairs([unowned, samsOwn], new Map(), nameOf);
    assert.equal(plan.status, "no-match");
  });

  test("two owned copies → ambiguous", () => {
    const again = metric({ id: "p2", team_id: "retail", owner_id: "pat" });
    const [plan] = planShareRepairs([unowned, patsOwn, again], new Map(), nameOf);
    assert.equal(plan.status, "ambiguous");
    assert.equal(plan.candidates.length, 2);
  });

  test("already tracked → only the copy needs archiving", () => {
    const tracked = { ...patsOwn, shared_team_ids: ["transformation"] };
    const [plan] = planShareRepairs([unowned, tracked], new Map(), nameOf);
    assert.equal(plan.status, "already-tracked");
  });

  test("archived measurables are ignored on both sides", () => {
    const plans = planShareRepairs([{ ...unowned, archived_at: 1 }, patsOwn], new Map(), nameOf);
    assert.equal(plans.length, 0);
  });
});

describe("groupByParent", () => {
  const parent = metric({ id: "p", team_id: "esd", owner_id: "pat" });
  const copyA = metric({ id: "a", team_id: "transformation" });
  const copyB = metric({ id: "b", team_id: "lending" });

  test("every copy folds into one parent, with the weeks only the copies have", () => {
    const entries = new Map([
      ["p", weeks(["2026-10-12", 7])],
      ["a", weeks(["2026-10-05", 4], ["2026-10-12", 7])],
      ["b", weeks(["2026-10-05", 4], ["2026-09-28", 3])],
    ]);
    const [g] = groupByParent(planShareRepairs([parent, copyA, copyB], entries, nameOf), entries);
    assert.equal(g.parent.id, "p");
    assert.deepEqual(g.copies.map((c) => c.unowned.id).sort(), ["a", "b"]);
    assert.deepEqual([...g.addWeeks].sort(), [["2026-09-28", 3], ["2026-10-05", 4]]);
    assert.deepEqual(g.conflicts, []);
  });

  test("copies that fill a missing week differently are a conflict", () => {
    const entries = new Map([
      ["p", weeks()],
      ["a", weeks(["2026-10-05", 4])],
      ["b", weeks(["2026-10-05", 5])],
    ]);
    const [g] = groupByParent(planShareRepairs([parent, copyA, copyB], entries, nameOf), entries);
    assert.deepEqual(g.conflicts, ["2026-10-05"]);
  });
});
