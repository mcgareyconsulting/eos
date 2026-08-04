import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mondayMidnightMsInTimeZone,
  selectHeadlinesDiscussedBeforeWeek,
  selectHeadlinesDiscussedDuringMeeting,
  selectIssuesClosedBeforeWeek,
  selectIssuesClosedDuringMeeting,
  selectTodosCompletedBeforeWeek,
  selectTodosCompletedDuringMeeting,
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

describe("selectHeadlinesDiscussedBeforeWeek", () => {
  const weekStart = 2_000_000;

  test("only discussed non-broadcast before week start", () => {
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
        {
          id: "bc",
          discussed: true,
          discussed_at: ts(weekStart - 1),
          broadcast: true,
        },
      ],
      weekStart,
    );
    assert.deepEqual(ids, ["old"]);
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
});
