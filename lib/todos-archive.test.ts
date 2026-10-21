import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mondayMidnightMsInTimeZone,
  selectHeadlinesDiscussedBeforeWeek,
  selectHeadlinesDiscussedDuringMeeting,
  selectIssuesClosedBeforeWeek,
  selectIssuesClosedDuringMeeting,
  selectTodosCompletedBeforeWeek,
  selectTodosClosedByMeetingEnd,
  pendingArchiveLabel,
  type TodoArchiveCandidate,
} from "./todos-archive";
import { APP_TIME_ZONE } from "./time-zone";

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

describe("selectTodosClosedByMeetingEnd", () => {
  const start = 1_000_000;
  const end = 1_090_000;

  test("archives pure todos closed by meeting end, in or out of the meeting", () => {
    const ids = selectTodosClosedByMeetingEnd(
      [
        todo({ id: "in", completed_at: ts(start + 5_000) }),
        todo({ id: "before", completed_at: ts(start - 86_400_000) }),
        todo({ id: "after", completed_at: ts(end + 120_000) }),
        todo({ id: "open", completed_at: null }),
      ],
      end,
    );
    assert.deepEqual(ids, ["in", "before"]);
  });

  test("skips milestones and already-archived", () => {
    const ids = selectTodosClosedByMeetingEnd(
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
      end,
    );
    assert.deepEqual(ids, []);
  });

  test("allows a 60s grace past meeting end", () => {
    const ids = selectTodosClosedByMeetingEnd(
      [todo({ id: "edge", completed_at: ts(end + 30_000) })],
      end,
    );
    assert.deepEqual(ids, ["edge"]);
  });

  test("leaves private todos for the Monday sweep", () => {
    // Private to-dos never appear in the L10, so the room never reviewed
    // them — Finish must not archive them.
    const ids = selectTodosClosedByMeetingEnd(
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
      end,
    );
    assert.deepEqual(ids, ["team", "unset"]);
  });
});

describe("pendingArchiveLabel", () => {
  test("team to-dos leave at Finish or Monday; private only Monday", () => {
    assert.equal(
      pendingArchiveLabel("team"),
      "Archiving Monday or after next meeting",
    );
    assert.equal(
      pendingArchiveLabel(undefined),
      "Archiving Monday or after next meeting",
    );
    assert.equal(pendingArchiveLabel("private"), "Archiving Monday");
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

// Restoring an item mid-meeting must actually restore it. Each restore path
// clears the field that made the item sweepable in the first place — an
// un-archive alone would leave the sweep free to re-archive it at Finish,
// which is the bug the client would experience as "it disappeared again".
// These pin the shape of a just-restored doc against the real selectors.
describe("restore survives the Finish sweep", () => {
  const start = 1_000_000;
  const end = 1_090_000;

  test("a restored to-do is not re-archived (completed_at cleared)", () => {
    const restored = todo({ id: "t", archived_at: null, completed_at: null });
    assert.deepEqual(
      selectTodosClosedByMeetingEnd([restored], end),
      [],
    );
    // Guard the test itself: with completed_at still set it WOULD be swept.
    const notCleared = todo({ id: "t", completed_at: ts(start + 1) });
    assert.deepEqual(
      selectTodosClosedByMeetingEnd([notCleared], end),
      ["t"],
    );
  });

  test("a restored issue is not re-archived (reopened)", () => {
    assert.deepEqual(
      selectIssuesClosedDuringMeeting(
        [{ id: "i", status: "open", resolved_at: null }],
        start,
        end,
      ),
      [],
    );
    // Guard: still solved inside the window and it WOULD be swept.
    assert.deepEqual(
      selectIssuesClosedDuringMeeting(
        [{ id: "i", status: "solved", resolved_at: ts(start + 1) }],
        start,
        end,
      ),
      ["i"],
    );
  });

  test("a restored headline is not re-archived (discuss cleared)", () => {
    assert.deepEqual(
      selectHeadlinesDiscussedDuringMeeting(
        [{ id: "h", discussed: false, discussed_at: null }],
        start,
        end,
      ),
      [],
    );
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

// The Monday sweep (functions/src/archive-stale-todos.ts) runs on the bank's
// clock, APP_TIME_ZONE (Mountain). Same DST checks as above, one hour west.
// Spring forward: Sun 2026-03-08 02:00 MST → 03:00 MDT (UTC-7 → UTC-6).
// Fall back:      Sun 2026-11-01 02:00 MDT → 01:00 MST (UTC-6 → UTC-7).
describe("mondayMidnightMsInTimeZone on the bank clock (APP_TIME_ZONE)", () => {
  function denverWall(ms: number) {
    return new Date(ms).toLocaleString("en-US", {
      timeZone: "America/Denver",
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

  test("the bank clock is Mountain time", () => {
    assert.equal(APP_TIME_ZONE, "America/Denver");
  });

  test("mid-week instant → that week's Monday 00:00 MDT (06:00 UTC)", () => {
    // Wednesday 2026-08-05 15:00 UTC = 09:00 MDT
    const ms = mondayMidnightMsInTimeZone(
      APP_TIME_ZONE,
      new Date("2026-08-05T15:00:00.000Z"),
    );
    assert.equal(ms, Date.UTC(2026, 7, 3, 6, 0, 0));
  });

  test("Sunday 23:30 Mountain is still the prior week (Central is already Monday)", () => {
    // Sun 2026-08-09 23:30 MDT = 2026-08-10T05:30Z = Mon 00:30 CDT.
    const now = new Date("2026-08-10T05:30:00.000Z");
    assert.equal(
      mondayMidnightMsInTimeZone(APP_TIME_ZONE, now),
      Date.UTC(2026, 7, 3, 6, 0, 0),
    );
    assert.equal(
      mondayMidnightMsInTimeZone("America/Chicago", now),
      Date.UTC(2026, 7, 10, 5, 0, 0),
    );
  });

  test("spring-forward Monday: 00:00 Mountain is 06:00 UTC (MDT)", () => {
    // Sweep fires Mon 2026-03-09 03:00 MDT = 09:00 UTC — first Monday on MDT.
    const ms = mondayMidnightMsInTimeZone(
      APP_TIME_ZONE,
      new Date("2026-03-09T09:00:00.000Z"),
    );
    assert.equal(ms, Date.UTC(2026, 2, 9, 6, 0, 0));
    const wall = denverWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /03\/09\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("walking back across spring-forward keeps Monday 00:00 MST (07:00 UTC)", () => {
    // Sun 2026-03-08 20:00 MDT (after the jump) = 2026-03-09T02:00Z; its
    // week's Monday (Mar 2) was still on MST.
    const ms = mondayMidnightMsInTimeZone(
      APP_TIME_ZONE,
      new Date("2026-03-09T02:00:00.000Z"),
    );
    assert.equal(ms, Date.UTC(2026, 2, 2, 7, 0, 0));
    const wall = denverWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /03\/02\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("fall-back Monday: 00:00 Mountain is 07:00 UTC (MST)", () => {
    // Sweep fires Mon 2026-11-02 03:00 MST = 10:00 UTC — first Monday on MST.
    const ms = mondayMidnightMsInTimeZone(
      APP_TIME_ZONE,
      new Date("2026-11-02T10:00:00.000Z"),
    );
    assert.equal(ms, Date.UTC(2026, 10, 2, 7, 0, 0));
    const wall = denverWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /11\/02\/2026/);
    assert.match(wall, /00:00:00/);
  });

  test("walking back across fall-back keeps Monday 00:00 MDT (06:00 UTC)", () => {
    // Sun 2026-11-01 22:00 MST (after the fall-back) = 2026-11-02T05:00Z;
    // its week's Monday (Oct 26) was still on MDT.
    const ms = mondayMidnightMsInTimeZone(
      APP_TIME_ZONE,
      new Date("2026-11-02T05:00:00.000Z"),
    );
    assert.equal(ms, Date.UTC(2026, 9, 26, 6, 0, 0));
    const wall = denverWall(ms);
    assert.match(wall, /Mon/);
    assert.match(wall, /10\/26\/2026/);
    assert.match(wall, /00:00:00/);
  });
});
