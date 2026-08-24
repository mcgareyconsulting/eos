import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_VOTES_PER_TEAM,
  priorityRank,
  rankLongTerm,
  rankShortTerm,
  splitIssuesByTerm,
  teamVoteTally,
  voteCredits,
  voteCreditsSummary,
  type RankableIssue,
} from "./issues";

// These rules are shared by the Issues tab and the in-meeting Issues segment.
// The two surfaces previously carried their own comparators and had already
// drifted (page ranked by priority, meeting by votes), so the ordering
// contract is pinned here rather than in either component.

const issue = (over: Partial<RankableIssue> & { id: string }): RankableIssue => ({
  type: "short",
  status: "open",
  priority: null,
  votes: 0,
  ...over,
});

describe("splitIssuesByTerm", () => {
  test("separates long-term from short-term", () => {
    const { short, long } = splitIssuesByTerm([
      issue({ id: "a", type: "short" }),
      issue({ id: "b", type: "long" }),
      issue({ id: "c", type: "short" }),
    ]);
    assert.deepEqual(
      short.map((i) => i.id),
      ["a", "c"],
    );
    assert.deepEqual(
      long.map((i) => i.id),
      ["b"],
    );
  });

  test("treats a missing type as short-term", () => {
    // QuickAddIssue stamps "short" on everything dropped from a meeting
    // stage, but older docs may predate the field entirely.
    const { short, long } = splitIssuesByTerm([
      issue({ id: "a", type: null }),
      issue({ id: "b", type: undefined }),
    ]);
    assert.equal(short.length, 2);
    assert.equal(long.length, 0);
  });

  test("handles an empty list", () => {
    const { short, long } = splitIssuesByTerm([]);
    assert.deepEqual(short, []);
    assert.deepEqual(long, []);
  });
});

describe("rankShortTerm", () => {
  test("ranks by vote total, highest first", () => {
    const ranked = rankShortTerm([
      issue({ id: "low", votes: 1 }),
      issue({ id: "high", votes: 5 }),
      issue({ id: "mid", votes: 3 }),
    ]);
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["high", "mid", "low"],
    );
  });

  test("puts unresolved issues above solved and dropped ones", () => {
    const ranked = rankShortTerm([
      issue({ id: "dropped", status: "dropped", votes: 9 }),
      issue({ id: "solved", status: "solved", votes: 9 }),
      issue({ id: "open", status: "open", votes: 0 }),
      issue({ id: "solving", status: "solving", votes: 0 }),
    ]);
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["open", "solving", "solved", "dropped"],
    );
  });

  test("votes outrank priority — priority is a label, not an order", () => {
    const ranked = rankShortTerm([
      issue({ id: "urgent-unvoted", priority: "urgent", votes: 0 }),
      issue({ id: "low-voted", priority: "low", votes: 2 }),
    ]);
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["low-voted", "urgent-unvoted"],
    );
  });

  test("pins the discussing issue to the top regardless of votes or status", () => {
    const ranked = rankShortTerm(
      [
        issue({ id: "top", votes: 9 }),
        issue({ id: "pinned", votes: 0, status: "solved" }),
      ],
      "pinned",
    );
    assert.equal(ranked[0].id, "pinned");
  });

  test("ignores a discussing id that isn't in the list", () => {
    const ranked = rankShortTerm(
      [issue({ id: "a", votes: 1 }), issue({ id: "b", votes: 2 })],
      "not-here",
    );
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["b", "a"],
    );
  });

  test("treats a missing vote count as zero", () => {
    const ranked = rankShortTerm([
      issue({ id: "none", votes: null }),
      issue({ id: "some", votes: 1 }),
    ]);
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["some", "none"],
    );
  });

  test("does not mutate the input array", () => {
    const input = [issue({ id: "a", votes: 1 }), issue({ id: "b", votes: 2 })];
    rankShortTerm(input);
    assert.deepEqual(
      input.map((i) => i.id),
      ["a", "b"],
    );
  });
});

describe("rankLongTerm", () => {
  test("ranks by the priority gate, with no priority sorting last", () => {
    const ranked = rankLongTerm([
      issue({ id: "none", priority: null }),
      issue({ id: "low", priority: "low" }),
      issue({ id: "urgent", priority: "urgent" }),
      issue({ id: "high", priority: "high" }),
    ]);
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["urgent", "high", "low", "none"],
    );
  });

  test("breaks priority ties on status", () => {
    const ranked = rankLongTerm([
      issue({ id: "solved", priority: "high", status: "solved" }),
      issue({ id: "open", priority: "high", status: "open" }),
    ]);
    assert.deepEqual(
      ranked.map((i) => i.id),
      ["open", "solved"],
    );
  });

  test("ignores votes — long-term issues are not votable", () => {
    const ranked = rankLongTerm([
      issue({ id: "voted", priority: "low", votes: 9 }),
      issue({ id: "urgent", priority: "urgent", votes: 0 }),
    ]);
    assert.equal(ranked[0].id, "urgent");
  });
});

describe("priorityRank", () => {
  test("orders urgent → low and sorts null last", () => {
    assert.ok(priorityRank("urgent") < priorityRank("high"));
    assert.ok(priorityRank("high") < priorityRank("low"));
    assert.ok(priorityRank("low") < priorityRank(null));
    assert.equal(priorityRank(undefined), priorityRank(null));
  });
});

describe("voteCredits", () => {
  test("tallies stacked votes across issues", () => {
    const { byIssue, used, remaining } = voteCredits([
      { issue_id: "a", count: 2 },
      { issue_id: "b", count: 1 },
    ]);
    assert.equal(byIssue.get("a"), 2);
    assert.equal(byIssue.get("b"), 1);
    assert.equal(used, 3);
    assert.equal(remaining, 0);
  });

  test("reports a full budget when nothing is spent", () => {
    const { used, remaining } = voteCredits([]);
    assert.equal(used, 0);
    assert.equal(remaining, MAX_VOTES_PER_TEAM);
  });

  test("defaults a missing count to one vote", () => {
    const { byIssue, used } = voteCredits([{ issue_id: "a" }]);
    assert.equal(byIssue.get("a"), 1);
    assert.equal(used, 1);
  });

  test("never reports negative remaining credits", () => {
    // A stale doc could over-count; the UI must not render "-2 left".
    const { remaining } = voteCredits([{ issue_id: "a", count: 99 }]);
    assert.equal(remaining, 0);
  });

  test("skips zero, negative and non-numeric counts", () => {
    const { byIssue, used } = voteCredits([
      { issue_id: "a", count: 0 },
      { issue_id: "b", count: -1 },
      { issue_id: "c", count: null },
      { issue_id: "d", count: 2 },
    ]);
    assert.equal(byIssue.has("a"), false);
    assert.equal(byIssue.has("b"), false);
    assert.equal(used, 3); // c defaults to 1, d contributes 2
  });
});

describe("voteCreditsSummary", () => {
  test("leads with remaining, not used", () => {
    const full = voteCreditsSummary(0);
    assert.equal(full.remaining, MAX_VOTES_PER_TEAM);
    assert.equal(full.label, `${MAX_VOTES_PER_TEAM} of ${MAX_VOTES_PER_TEAM} left`);
    assert.equal(full.depleted, false);
    assert.match(full.detail, /each person gets/i);

    const mid = voteCreditsSummary(2);
    assert.equal(mid.remaining, 1);
    assert.equal(mid.label, "1 of 3 left");
    assert.equal(mid.depleted, false);

    const empty = voteCreditsSummary(3);
    assert.equal(empty.remaining, 0);
    assert.equal(empty.label, "0 of 3 left");
    assert.equal(empty.depleted, true);
    assert.match(empty.detail, /reset when the meeting ends/i);
  });

  test("clamps over-spent used counts", () => {
    const s = voteCreditsSummary(99);
    assert.equal(s.remaining, 0);
    assert.equal(s.depleted, true);
  });
});

describe("teamVoteTally", () => {
  const cast = (...counts: number[]) => counts.map((votes) => ({ votes }));

  test("counts credits spent across every issue against the room's budget", () => {
    const t = teamVoteTally(cast(3, 2, 1), 4); // 4 present x 3 = 12
    assert.equal(t.cast, 6);
    assert.equal(t.available, 12);
    assert.equal(t.allIn, false);
    assert.equal(t.label, "6 of 12 votes cast");
  });

  test("flips to all-in once the room has spent everything", () => {
    const t = teamVoteTally(cast(5, 4), 3); // 9 of 9
    assert.equal(t.allIn, true);
    assert.equal(t.label, "All votes in");
  });

  test("excludes absentees from the denominator", () => {
    // 5 on the roster, 2 marked absent — the reachable budget is 3 x 3.
    assert.equal(teamVoteTally(cast(9), 3).allIn, true);
  });

  test("an empty room is never 'all in'", () => {
    const t = teamVoteTally([], 0);
    assert.equal(t.available, 0);
    assert.equal(t.allIn, false);
  });

  test("ignores missing, zero and malformed vote counts", () => {
    const t = teamVoteTally(
      [{ votes: null }, { votes: 0 }, {}, { votes: Number.NaN }, { votes: 2 }],
      2,
    );
    assert.equal(t.cast, 2);
    assert.equal(t.available, 2 * MAX_VOTES_PER_TEAM);
  });
});
