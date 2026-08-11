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

  test("shows department rock on my team", () => {
    assert.equal(
      shouldShowHomeRock(
        rock({ id: "r2", owner_id: null, rock_type: "department" }),
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
