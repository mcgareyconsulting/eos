import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  compareGroups,
  groupDocId,
  groupNameKey,
  nextGroupSortOrder,
  orderGroupNames,
  reorderGroup,
  type ScorecardGroup,
} from "./scorecard-groups";

const group = (
  over: Partial<ScorecardGroup> & { id: string; name: string },
): ScorecardGroup => ({
  team_id: "t1",
  interval: "weekly",
  sort_order: 0,
  ...over,
});

describe("groupNameKey", () => {
  test("is case- and whitespace-insensitive, so one group stays one group", () => {
    assert.equal(groupNameKey("Compliance"), groupNameKey("  compliance "));
    assert.notEqual(groupNameKey("Compliance"), groupNameKey("Complianc"));
  });

  test("treats blank and missing the same", () => {
    assert.equal(groupNameKey(null), "");
    assert.equal(groupNameKey("   "), "");
  });
});

describe("groupDocId", () => {
  test("is deterministic, so re-importing updates instead of duplicating", () => {
    assert.equal(groupDocId("t1", "Compliance"), groupDocId("t1", "compliance"));
  });

  test("separates teams", () => {
    assert.notEqual(groupDocId("t1", "Weekly"), groupDocId("t2", "Weekly"));
  });

  test("survives punctuation and never produces a bare id", () => {
    assert.equal(groupDocId("t1", "A/B  &  C!"), "t1__group__a-b-c");
    assert.equal(groupDocId("t1", "***"), "t1__group__unnamed");
  });
});

describe("compareGroups", () => {
  test("orders by position, not alphabetically", () => {
    const weekly = group({ id: "g1", name: "Weekly", sort_order: 0 });
    const compliance = group({ id: "g2", name: "Compliance", sort_order: 1 });
    // The whole point: Compliance sorts BELOW Weekly despite the alphabet.
    assert.ok(compareGroups(weekly, compliance) < 0);
  });

  test("falls back to name so equal positions are still deterministic", () => {
    const a = group({ id: "g1", name: "Alpha", sort_order: 3 });
    const b = group({ id: "g2", name: "Beta", sort_order: 3 });
    assert.ok(compareGroups(a, b) < 0);
  });
});

describe("nextGroupSortOrder", () => {
  test("appends after the last group in that period", () => {
    const groups = [
      group({ id: "g1", name: "Weekly", sort_order: 0 }),
      group({ id: "g2", name: "Compliance", sort_order: 1 }),
    ];
    assert.equal(nextGroupSortOrder(groups, "weekly"), 2);
  });

  test("counts only the target period", () => {
    const groups = [
      group({ id: "g1", name: "Weekly", sort_order: 0 }),
      group({ id: "g2", name: "Board", interval: "monthly", sort_order: 7 }),
    ];
    assert.equal(nextGroupSortOrder(groups, "monthly"), 8);
    assert.equal(nextGroupSortOrder(groups, "quarterly"), 0);
  });

  test("the first group in a period starts at zero", () => {
    assert.equal(nextGroupSortOrder([], "weekly"), 0);
  });
});

describe("orderGroupNames", () => {
  const groups = [
    group({ id: "g1", name: "Weekly", sort_order: 0 }),
    group({ id: "g2", name: "Compliance", sort_order: 1 }),
  ];

  test("puts Compliance below Weekly", () => {
    assert.deepEqual(
      orderGroupNames(["Compliance", "Weekly"], groups, "weekly"),
      ["Weekly", "Compliance"],
    );
  });

  test("matches names case-insensitively", () => {
    assert.deepEqual(orderGroupNames(["compliance"], groups, "weekly"), [
      "compliance",
    ]);
  });

  test("unmanaged labels collect at the bottom rather than vanishing", () => {
    assert.deepEqual(
      orderGroupNames(["Ad hoc", "Compliance", "Weekly"], groups, "weekly"),
      ["Weekly", "Compliance", "Ad hoc"],
    );
  });

  test("a group belonging to another period drops out of this one", () => {
    const withMonthly = [
      ...groups,
      group({ id: "g3", name: "Board", interval: "monthly", sort_order: 0 }),
    ];
    assert.deepEqual(
      orderGroupNames(["Board", "Weekly"], withMonthly, "weekly"),
      ["Weekly"],
    );
  });

  test("no group docs at all falls back to alphabetical", () => {
    assert.deepEqual(orderGroupNames(["Weekly", "Compliance"], [], "weekly"), [
      "Compliance",
      "Weekly",
    ]);
  });
});

describe("reorderGroup", () => {
  const groups = [
    group({ id: "g1", name: "Weekly", sort_order: 0 }),
    group({ id: "g2", name: "Compliance", sort_order: 1 }),
    group({ id: "g3", name: "Ad hoc", sort_order: 2 }),
  ];

  test("swaps with its neighbour and returns only what changed", () => {
    const writes = reorderGroup(groups, "g2", -1);
    assert.deepEqual(writes, [
      { id: "g2", sort_order: 0 },
      { id: "g1", sort_order: 1 },
    ]);
  });

  test("is inert at the ends", () => {
    assert.deepEqual(reorderGroup(groups, "g1", -1), []);
    assert.deepEqual(reorderGroup(groups, "g3", 1), []);
  });

  test("ignores an unknown group", () => {
    assert.deepEqual(reorderGroup(groups, "nope", 1), []);
  });

  test("moves only within its own period", () => {
    const mixed = [
      group({ id: "g1", name: "Weekly", sort_order: 0 }),
      group({ id: "m1", name: "Board", interval: "monthly", sort_order: 0 }),
      group({ id: "g2", name: "Compliance", sort_order: 1 }),
    ];
    // Compliance moving up swaps with Weekly, never with the monthly group.
    assert.deepEqual(reorderGroup(mixed, "g2", -1), [
      { id: "g2", sort_order: 0 },
      { id: "g1", sort_order: 1 },
    ]);
  });

  test("rewrites duplicate or sparse positions into a dense sequence", () => {
    const messy = [
      group({ id: "a", name: "A", sort_order: 5 }),
      group({ id: "b", name: "B", sort_order: 5 }),
      group({ id: "c", name: "C", sort_order: 9 }),
    ];
    // Every row is rewritten here, including "a" — it held 5 and now holds 0.
    // That is the repair: the list comes out 0,1,2 with the duplicate gone.
    const writes = reorderGroup(messy, "c", -1);
    assert.deepEqual(writes, [
      { id: "a", sort_order: 0 },
      { id: "c", sort_order: 1 },
      { id: "b", sort_order: 2 },
    ]);
  });
});
