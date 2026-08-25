import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  byDueDateAsc,
  homeRockPillKind,
  isHomeRockActive,
  rockHasMyOpenMilestone,
  selectHomeTodos,
  selectMilestonesForRocks,
  shouldShowHomeRock,
  splitHomeRocksByType,
  todoVisibilityLabel,
  type HomeRockLike,
} from "./home-board";

const me = "user-me";
const other = "user-other";
const teamA = "team-a";
const teamB = "team-b";

function rock(partial: Partial<HomeRockLike> & { id: string }): HomeRockLike {
  return {
    owner_id: other,
    team_id: teamA,
    status: "on_track",
    archived_at: null,
    rock_type: "individual",
    shared_team_ids: [],
    ...partial,
  };
}

describe("todoVisibilityLabel", () => {
  test("maps team → Public and private → Private", () => {
    assert.equal(todoVisibilityLabel("team"), "Public");
    assert.equal(todoVisibilityLabel("private"), "Private");
    assert.equal(todoVisibilityLabel(undefined), "Public");
  });
});

describe("selectHomeTodos", () => {
  test("keeps only my pure open todos", () => {
    const rows = [
      {
        id: "1",
        owner_id: me,
        source_rock_id: null,
        completed_at: null,
        visibility: "team",
      },
      {
        id: "2",
        owner_id: other,
        source_rock_id: null,
        completed_at: null,
        visibility: "team",
      },
      {
        id: "3",
        owner_id: me,
        source_rock_id: "rock-1",
        completed_at: null,
        visibility: "team",
      },
      {
        id: "4",
        owner_id: me,
        source_rock_id: null,
        completed_at: "done",
        visibility: "private",
      },
    ];
    assert.deepEqual(
      selectHomeTodos(rows, me).map((t) => t.id),
      ["1"],
    );
  });
});

describe("shouldShowHomeRock", () => {
  const myTeams = new Set([teamA]);

  test("shows my individual rock", () => {
    assert.equal(
      shouldShowHomeRock(rock({ id: "r1", owner_id: me }), {
        uid: me,
        myTeamIds: myTeams,
        hasMyOpenMilestone: false,
      }),
      true,
    );
  });

  test("shows department rock on my team (legacy null owner)", () => {
    assert.equal(
      shouldShowHomeRock(
        rock({ id: "r2", owner_id: null, rock_type: "department" }),
        { uid: me, myTeamIds: myTeams, hasMyOpenMilestone: false },
      ),
      true,
    );
  });

  test("shows department rock owned by a person (Steph model)", () => {
    // Team/department priority with Joe accountable — still a department rock
    // for the home board when I'm on that team.
    assert.equal(
      shouldShowHomeRock(
        rock({
          id: "r2b",
          owner_id: other,
          rock_type: "department",
        }),
        { uid: me, myTeamIds: myTeams, hasMyOpenMilestone: false },
      ),
      true,
    );
  });

  test("hides other people's individual rocks without my milestone", () => {
    assert.equal(
      shouldShowHomeRock(rock({ id: "r3", owner_id: other }), {
        uid: me,
        myTeamIds: myTeams,
        hasMyOpenMilestone: false,
      }),
      false,
    );
  });

  test("shows other person's rock when I have an open milestone", () => {
    assert.equal(
      shouldShowHomeRock(rock({ id: "r4", owner_id: other }), {
        uid: me,
        myTeamIds: myTeams,
        hasMyOpenMilestone: true,
      }),
      true,
    );
  });

  test("shows rock shared into my team", () => {
    assert.equal(
      shouldShowHomeRock(
        rock({
          id: "r5",
          team_id: teamB,
          owner_id: other,
          shared_team_ids: [teamA],
        }),
        { uid: me, myTeamIds: myTeams, hasMyOpenMilestone: false },
      ),
      true,
    );
  });

  test("hides done rocks", () => {
    assert.equal(
      shouldShowHomeRock(rock({ id: "r6", owner_id: me, status: "done" }), {
        uid: me,
        myTeamIds: myTeams,
        hasMyOpenMilestone: false,
      }),
      false,
    );
  });
});

describe("isHomeRockActive", () => {
  test("only on_track and off_track without archive", () => {
    assert.equal(isHomeRockActive(rock({ id: "a", status: "on_track" })), true);
    assert.equal(isHomeRockActive(rock({ id: "b", status: "off_track" })), true);
    assert.equal(isHomeRockActive(rock({ id: "c", status: "done" })), false);
    assert.equal(
      isHomeRockActive(rock({ id: "d", status: "on_track", archived_at: {} })),
      false,
    );
  });
});

describe("homeRockPillKind", () => {
  test("team for department / null owner, person otherwise", () => {
    assert.equal(
      homeRockPillKind(rock({ id: "1", owner_id: null })),
      "team",
    );
    assert.equal(
      homeRockPillKind(rock({ id: "2", rock_type: "department", owner_id: other })),
      "team",
    );
    assert.equal(
      homeRockPillKind(rock({ id: "3", owner_id: other, rock_type: "individual" })),
      "person",
    );
  });
});

describe("rockHasMyOpenMilestone + selectMilestonesForRocks", () => {
  test("detects my open milestone and filters parent-hidden", () => {
    const milestones = [
      {
        id: "m1",
        owner_id: me,
        source_rock_id: "r1",
        completed_at: null,
      },
      {
        id: "m2",
        owner_id: other,
        source_rock_id: "r1",
        completed_at: null,
      },
      {
        id: "m3",
        owner_id: me,
        source_rock_id: "r-done",
        completed_at: null,
      },
    ];
    assert.equal(rockHasMyOpenMilestone("r1", milestones, me), true);
    assert.equal(rockHasMyOpenMilestone("r1", milestones, other), true);
    assert.equal(rockHasMyOpenMilestone("r-none", milestones, me), false);

    const rocksById = new Map([
      ["r1", { status: "on_track", archived_at: null }],
      ["r-done", { status: "done", archived_at: null }],
    ]);
    const kept = selectMilestonesForRocks(milestones, rocksById);
    assert.deepEqual(
      kept.map((m) => m.id).sort(),
      ["m1", "m2"],
    );
  });
});

describe("byDueDateAsc", () => {
  test("nulls last", () => {
    const rows = [
      { due_date: null as string | null },
      { due_date: "2026-08-01" },
      { due_date: "2026-07-01" },
    ];
    rows.sort(byDueDateAsc);
    assert.deepEqual(
      rows.map((r) => r.due_date),
      ["2026-07-01", "2026-08-01", null],
    );
  });
});

describe("splitHomeRocksByType (N34)", () => {
  const rocks = [
    { id: "a", owner_id: "u-cora", rock_type: "individual" },
    { id: "b", owner_id: "u-cora", rock_type: "department" },
    { id: "c", owner_id: "u-joe", rock_type: null },
    { id: "d", owner_id: "u-joe", rock_type: "company" },
    { id: "e", owner_id: "u-cora", rock_type: "team" },
  ];

  test("department and company rocks form the departmental section", () => {
    const { mine, departmental } = splitHomeRocksByType(rocks);
    assert.deepEqual(
      departmental.map((r) => r.id),
      ["b", "d"],
    );
    assert.deepEqual(
      mine.map((r) => r.id),
      ["a", "c", "e"],
    );
  });

  test("a department rock the viewer owns is still departmental", () => {
    // Rock "b" is owned by Cora and still belongs to the department — the
    // split is by kind, not by who happens to own it.
    const { departmental } = splitHomeRocksByType(rocks);
    assert.ok(departmental.some((r) => r.id === "b"));
  });

  test("a legacy rock with no owner counts as departmental", () => {
    const { mine, departmental } = splitHomeRocksByType([
      { id: "legacy", owner_id: null, rock_type: null },
      { id: "blank", owner_id: "", rock_type: "individual" },
    ]);
    assert.deepEqual(
      departmental.map((r) => r.id),
      ["legacy", "blank"],
    );
    assert.deepEqual(mine, []);
  });

  test("preserves the incoming order inside each section", () => {
    const { mine } = splitHomeRocksByType(rocks);
    assert.deepEqual(
      mine.map((r) => r.id),
      ["a", "c", "e"],
    );
  });

  test("an empty board yields two empty sections, not undefined", () => {
    const { mine, departmental } = splitHomeRocksByType([]);
    assert.deepEqual(mine, []);
    assert.deepEqual(departmental, []);
  });
});
