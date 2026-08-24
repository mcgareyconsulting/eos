import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mondayMidnightMsInTimeZone,
  selectHeadlinesDiscussedBeforeWeek,
  selectHeadlinesDiscussedDuringMeeting,
  selectIssuesClosedBeforeWeek,
  selectIssuesClosedDuringMeeting,
  selectRocksDoneBeforeWeek,
  selectTodosCompletedBeforeWeek,
  selectTodosCompletedDuringMeeting,
  type RockArchiveCandidate,
  type TodoArchiveCandidate,
} from "./todos-archive";

function ts(ms: number) {
  return { toMillis: () => ms };
}

function todo(
  over: Partial<TodoArchiveCandidate> & { id: string },
): TodoArchiveCandidate {
  return {
    archived_at: null,
    source_rock_id: null,
    completed_at: null,
    ...over,
  };
}

describe("selectTodosCompletedDuringMeeting", () => {
  const start = 1_000_000;
  const end = 1_090_000;

  test("archives pure todos completed inside the meeting window", () => {
    const ids = selectTodosCompletedDuringMeeting(
      [
        todo({ id: "in", completed_at: ts(start + 5_000) }),
        todo({ id: "before", completed_at: ts(start - 1) }),
        todo({ id: "after", completed_at: ts(end + 120_000) }),
        todo({ id: "open", completed_at: null }),
      ],
      start,
      end,
    );
    assert.deepEqual(ids, ["in"]);
  });

  test("skips milestones and already-archived", () => {
    const ids = selectTodosCompletedDuringMeeting(
      [
        todo({
          id: "ms",
          completed_at: ts(start + 1),
          source_rock_id: "rock-1",
        }),
        todo({
          id: "arch",
          completed_at: ts(start + 1),
          archived_at: ts(end),
        }),
      ],
      start,
      end,
    );
    assert.deepEqual(ids, []);
  });

  test("allows a 60s grace past meeting end", () => {
    const ids = selectTodosCompletedDuringMeeting(
      [todo({ id: "edge", completed_at: ts(end + 30_000) })],
      start,
      end,
    );
    assert.deepEqual(ids, ["edge"]);
  });

  test("leaves private todos for the Monday sweep even inside the window", () => {
    // A member checking off their own private to-do mid-meeting is a
    // "closed outside the meeting" event — Finish must not archive it.
    const ids = selectTodosCompletedDuringMeeting(
      [
        todo({
          id: "priv",
          completed_at: ts(start + 5_000),
          visibility: "private",
        }),
        todo({
          id: "team",
          completed_at: ts(start + 5_000),
          visibility: "team",
        }),
        todo({ id: "unset", completed_at: ts(start + 5_000) }),
      ],
      start,
      end,
    );
    assert.deepEqual(ids, ["team", "unset"]);
  });
});

describe("selectTodosCompletedBeforeWeek", () => {
  // Monday 00:00 of "this" week
  const weekStart = Date.UTC(2026, 7, 3); // 2026-08-03

  test("archives last week's completions, keeps this week's", () => {
    const ids = selectTodosCompletedBeforeWeek(
      [
        todo({ id: "last-week", completed_at: ts(weekStart - 86_400_000) }),
        todo({ id: "this-week", completed_at: ts(weekStart + 3_600_000) }),
        todo({ id: "open", completed_at: null }),
      ],
      weekStart,
    );
    assert.deepEqual(ids, ["last-week"]);
  });

  test("skips milestones", () => {
    const ids = selectTodosCompletedBeforeWeek(
      [
        todo({
          id: "ms",
          completed_at: ts(weekStart - 1),
          source_rock_id: "r",
        }),
      ],
      weekStart,
    );
    assert.deepEqual(ids, []);
  });

  test("includes private todos — the sweep is their only auto-archive path", () => {
    const ids = selectTodosCompletedBeforeWeek(
      [
        todo({
          id: "priv",
          completed_at: ts(weekStart - 1),
          visibility: "private",
        }),
      ],
      weekStart,
    );
    assert.deepEqual(ids, ["priv"]);
  });
});

describe("selectIssuesClosedDuringMeeting", () => {
  const start = 1_000_000;
  const end = 1_090_000;

  test("archives solved/dropped with resolved_at in window", () => {
    const ids = selectIssuesClosedDuringMeeting(
      [
        { id: "s", status: "solved", resolved_at: ts(start + 1) },
        { id: "d", status: "dropped", resolved_at: ts(start + 2) },
        { id: "open", status: "open", resolved_at: null },
        { id: "early", status: "solved", resolved_at: ts(start - 1) },
      ],
      start,
      end,
    );
    assert.deepEqual(ids.sort(), ["d", "s"]);
  });
});

describe("selectIssuesClosedBeforeWeek", () => {
  const weekStart = 2_000_000;

  test("archives issues solved or dropped before the week boundary", () => {
    const ids = selectIssuesClosedBeforeWeek(
      [
        { id: "solved-old", status: "solved", resolved_at: ts(weekStart - 1) },
        { id: "dropped-old", status: "dropped", resolved_at: ts(weekStart - 5) },
        { id: "solved-new", status: "solved", resolved_at: ts(weekStart + 1) },
        { id: "at-boundary", status: "solved", resolved_at: ts(weekStart) },
      ],
      weekStart,
    );
    assert.deepEqual(ids.sort(), ["dropped-old", "solved-old"]);
  });

  test("skips open/solving issues and closed ones missing resolved_at", () => {
    const ids = selectIssuesClosedBeforeWeek(
      [
        { id: "open", status: "open", resolved_at: ts(weekStart - 1) },
        { id: "solving", status: "solving", resolved_at: ts(weekStart - 1) },
        { id: "no-stamp", status: "solved", resolved_at: null },
        { id: "missing-stamp", status: "dropped" },
      ],
      weekStart,
    );
    assert.deepEqual(ids, []);
  });

  test("skips already-archived issues", () => {
    const ids = selectIssuesClosedBeforeWeek(
      [
        {
          id: "arch",
          status: "solved",
          resolved_at: ts(weekStart - 1),
          archived_at: ts(weekStart - 1),
        },
      ],
      weekStart,
    );
    assert.deepEqual(ids, []);
  });

  test("returns nothing for a non-finite boundary", () => {
    const ids = selectIssuesClosedBeforeWeek(
      [{ id: "s", status: "solved", resolved_at: ts(0) }],
      Number.NaN,
    );
    assert.deepEqual(ids, []);
  });
});

describe("selectHeadlinesDiscussedBeforeWeek", () => {
  const weekStart = 2_000_000;

  test("only discussed before week start; standing items never close", () => {
    const ids = selectHeadlinesDiscussedBeforeWeek(
      [
        {
          id: "old",
          discussed: true,
          discussed_at: ts(weekStart - 1),
        },
        {
          id: "new",
          discussed: true,
          discussed_at: ts(weekStart + 1),
        },
        {
          id: "stand",
          discussed: false,
          discussed_at: null,
        },
      ],
      weekStart,
    );
    assert.deepEqual(ids, ["old"]);
  });

  // Broadcast copies used to be held back here. They are not any more: a
  // cascaded headline is fanned out one doc per team, so closing this team's
  // copy after they have shared it leaves every other team's queue alone.
  // Client ask, 8/19 L10 — "each team will have that in their queue to
  // share ... when they mark it off, it's setting the status that it was
  // shared with a team, not that it's not available to share anymore."
  test("a broadcast copy archives like any other once discussed", () => {
    const ids = selectHeadlinesDiscussedBeforeWeek(
      [
        {
          id: "bc",
          discussed: true,
          discussed_at: ts(weekStart - 1),
        },
      ],
      weekStart,
    );
    assert.deepEqual(ids, ["bc"]);
  });
});

describe("selectRocksDoneBeforeWeek", () => {
  const weekStart = Date.UTC(2026, 7, 3); // 2026-08-03

  function rock(
    over: Partial<RockArchiveCandidate> & { id: string },
  ): RockArchiveCandidate {
    return {
      archived_at: null,
      status: "done",
      completed_at: null,
      ...over,
    };
  }

  test("archives done rocks completed before this week's Monday", () => {
    const ids = selectRocksDoneBeforeWeek(
      [
        rock({ id: "last-week", completed_at: ts(weekStart - 86_400_000) }),
        rock({ id: "this-week", completed_at: ts(weekStart + 3_600_000) }),
        rock({ id: "open", status: "on_track", completed_at: null }),
        rock({ id: "cancelled", status: "cancelled", completed_at: ts(weekStart - 1) }),
      ],
      weekStart,
    );
    assert.deepEqual(ids, ["last-week"]);
  });

  test("skips already-archived and done-without-completed_at", () => {
    const ids = selectRocksDoneBeforeWeek(
      [
        rock({
          id: "arch",
          completed_at: ts(weekStart - 1),
          archived_at: ts(weekStart - 1),
        }),
        rock({ id: "no-stamp", completed_at: null }),
      ],
      weekStart,
    );
    assert.deepEqual(ids, []);
  });

  test("returns nothing for a non-finite boundary", () => {
    const ids = selectRocksDoneBeforeWeek(
      [rock({ id: "x", completed_at: ts(0) })],
      Number.NaN,
    );
    assert.deepEqual(ids, []);
  });
});

describe("selectHeadlinesDiscussedDuringMeeting", () => {
  test("windowed discuss only", () => {
    const start = 10;
    const end = 100;
    const ids = selectHeadlinesDiscussedDuringMeeting(
      [
        { id: "in", discussed: true, discussed_at: ts(50) },
        { id: "out", discussed: true, discussed_at: ts(5) },
      ],
      start,
      end,
    );
    assert.deepEqual(ids, ["in"]);
  });
});

describe("mondayMidnightMsInTimeZone", () => {
  test("returns Monday 00:00 America/Chicago for a mid-week instant", () => {
    // Wednesday 2026-08-05 15:00 UTC ≈ mid-morning Chicago
    const now = new Date("2026-08-05T15:00:00.000Z");
    const ms = mondayMidnightMsInTimeZone("America/Chicago", now);
    const wall = new Date(ms).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    // Monday Aug 3 2026 00:00 Chicago
    assert.match(wall, /Mon/);
    assert.match(wall, /08\/03\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("Sunday evening still belongs to the prior week's Monday start", () => {
    // Sunday 2026-08-09 22:00 Chicago ≈ 2026-08-10 03:00 UTC (CDT)
    const now = new Date("2026-08-10T03:00:00.000Z");
    const ms = mondayMidnightMsInTimeZone("America/Chicago", now);
    const wall = new Date(ms).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hourCycle: "h23",
    });
    // Week of Aug 3–9: Monday is still Aug 3
    assert.match(wall, /Mon/);
    assert.match(wall, /08\/03\/2026/);
  });

  // --- DST transitions (America/Chicago) ----------------------------------
  // Spring forward: Sun 2026-03-08 02:00 CST → 03:00 CDT (UTC-6 → UTC-5).
  // Fall back:      Sun 2026-11-01 02:00 CDT → 01:00 CST (UTC-5 → UTC-6).
  // The sweep fires Monday 03:00 local; the boundary it computes must be
  // that same week's Monday 00:00 *civil* time, whatever the offset is.

  function chicagoWall(ms: number) {
    return new Date(ms).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }

  test("spring-forward Monday: 00:00 Chicago is 05:00 UTC (CDT)", () => {
    // Worker fires Mon 2026-03-09 03:00 CDT = 08:00 UTC — first Monday on CDT.
    const now = new Date("2026-03-09T08:00:00.000Z");
    const ms = mondayMidnightMsInTimeZone("America/Chicago", now);
    assert.equal(ms, Date.UTC(2026, 2, 9, 5, 0, 0));
    const wall = chicagoWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /03\/09\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("walking back across spring-forward keeps Monday 00:00 CST (06:00 UTC)", () => {
    // Sun 2026-03-08 20:00 CDT (after the jump) = 2026-03-09T01:00Z; its
    // week's Monday (Mar 2) was still on CST, so midnight there is 06:00 UTC.
    const now = new Date("2026-03-09T01:00:00.000Z");
    const ms = mondayMidnightMsInTimeZone("America/Chicago", now);
    assert.equal(ms, Date.UTC(2026, 2, 2, 6, 0, 0));
    const wall = chicagoWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /03\/02\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("fall-back Monday: 00:00 Chicago is 06:00 UTC (CST)", () => {
    // Worker fires Mon 2026-11-02 03:00 CST = 09:00 UTC — first Monday on CST.
    const now = new Date("2026-11-02T09:00:00.000Z");
    const ms = mondayMidnightMsInTimeZone("America/Chicago", now);
    assert.equal(ms, Date.UTC(2026, 10, 2, 6, 0, 0));
    const wall = chicagoWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /11\/02\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("walking back across fall-back keeps Monday 00:00 CDT (05:00 UTC)", () => {
    // Sun 2026-11-01 22:00 CST (after the fall-back) = 2026-11-02T04:00Z;
    // its week's Monday (Oct 26) was still on CDT, so midnight is 05:00 UTC.
    const now = new Date("2026-11-02T04:00:00.000Z");
    const ms = mondayMidnightMsInTimeZone("America/Chicago", now);
    assert.equal(ms, Date.UTC(2026, 9, 26, 5, 0, 0));
    const wall = chicagoWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /10\/26\/2026/);
    assert.match(wall, /00:00:00/);
  });
});
