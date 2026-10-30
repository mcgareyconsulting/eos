import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { auditScorecards, originalGuess } from "./scorecard-audit";
import type { Point } from "./scorecard-diff";
import type { RepairMetric } from "./scorecard-share-repair";

const names: Record<string, string> = { katy: "Katy Bell", pat: "Pat Lee" };
const m = (x: Partial<RepairMetric> & { id: string; team_id: string }): RepairMetric => ({ name: "Loans", owner_id: null, ...x });
const pts = (...v: (number | null)[]) =>
  new Map<string, Point>(v.map((value, i) => [`2026-09-${String(7 + 7 * i).padStart(2, "0")}`, { value }]));

function run(metrics: RepairMetric[], entries: [string, Map<string, Point>][] = [], member: [string, string[]][] = []) {
  return auditScorecards({
    metrics,
    entries: new Map(entries),
    memberships: new Map(member.map(([u, t]) => [u, new Set(t)])),
    nameOf: (uid) => names[uid] ?? uid,
  });
}

describe("auditScorecards", () => {
  test("no owner and no other measurable by the name → truly unassigned", () => {
    const { rows } = run([m({ id: "u", team_id: "t1", name: "Orphan" }), m({ id: "o", team_id: "t2", owner_id: "pat" })]);
    assert.equal(rows.find((r) => r.metric.id === "u")?.category, "truly-unassigned");
  });

  test("the name only as No Owner copies → unassigned but duplicated", () => {
    const { rows } = run([m({ id: "a", team_id: "t1" }), m({ id: "b", team_id: "t2" })]);
    assert.deepEqual(rows.map((r) => r.category), ["unassigned-duplicated", "unassigned-duplicated"]);
  });

  test("a No Owner copy whose note names the owner → copy of the original, diffed", () => {
    const { rows, people } = run(
      [m({ id: "o", team_id: "esd", owner_id: "katy" }), m({ id: "u", team_id: "tr", description: "Imported owner: Katy Bell" })],
      [["o", pts(1, 2, 3)], ["u", pts(1, 2, null)]],
      [["katy", ["esd"]]],
    );
    const copy = rows.find((r) => r.metric.id === "u")!;
    assert.equal(copy.category, "copy-of-original");
    assert.equal(copy.diff?.verdict, "stale-copy");
    assert.deepEqual(people[0].flags, ["OUT OF SYNC"]);
    assert.equal(people[0].copiesToUnify, 1);
  });

  test("a note naming someone else → not a copy of that original", () => {
    const { rows } = run([m({ id: "o", team_id: "esd", owner_id: "katy" }), m({ id: "u", team_id: "tr", description: "Imported owner: Sam Ortiz" })]);
    assert.equal(rows.find((r) => r.metric.id === "u")?.category, "unassigned-other-owner-has-name");
  });

  test("same owner on several teams: the one on their own team is the original; scattered, off roster, out of sync", () => {
    const { rows, people } = run(
      [
        m({ id: "home", team_id: "esd", owner_id: "katy" }),
        m({ id: "x", team_id: "tr", owner_id: "katy" }),
        m({ id: "y", team_id: "lend", owner_id: "katy" }),
      ],
      [["home", pts(1, 2, 3)], ["x", pts(1, 2, 3)], ["y", pts(1, 9, 3)]],
      [["katy", ["esd"]]],
    );
    assert.equal(rows.find((r) => r.category === "original")?.metric.id, "home");
    const katy = people.find((p) => p.uid === "katy")!;
    assert.deepEqual(katy.flags, ["SCATTERED", "OFF ROSTER", "DUPLICATES", "OUT OF SYNC", "CONFLICT"]);
    assert.equal(katy.offRoster.length, 2);
  });
});

describe("originalGuess", () => {
  test("the copy with the most recent number wins, even over the owner's team", () => {
    const metrics = [
      m({ id: "home", team_id: "esd", owner_id: "katy" }),
      m({ id: "x", team_id: "tr", owner_id: "katy" }),
      m({ id: "u", team_id: "lend", description: "Imported owner: Katy Bell" }),
    ];
    const entries: [string, Map<string, Point>][] = [["home", pts(1, 2)], ["x", pts(1, 2, 3)], ["u", pts(1)]];
    const { rows } = run(metrics, entries, [["katy", ["esd"]]]);
    const guess = originalGuess(rows, new Map(entries));
    assert.equal(rows.find((r) => r.category === "original")?.metric.id, "home");
    assert.deepEqual(["home", "x", "u"].map((id) => guess.get(id)?.id), ["x", "x", "x"]);
  });

  test("No Owner copies with no original are guessed among themselves", () => {
    const entries: [string, Map<string, Point>][] = [["a", pts(1)], ["b", pts(1, 2)]];
    const { rows } = run([m({ id: "a", team_id: "t1" }), m({ id: "b", team_id: "t2" })], entries);
    assert.equal(originalGuess(rows, new Map(entries)).get("a")?.id, "b");
  });
});
