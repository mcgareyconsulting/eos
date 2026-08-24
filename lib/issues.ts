// Shared vocabulary and ranking rules for issues.
//
// Issues render on two surfaces — the standalone Issues tab and the in-meeting
// Issues segment — which previously carried verbatim copies of these label/badge
// maps and their own sort comparators, and had already drifted apart (the page
// ranked by priority, the meeting by votes). Everything order- or
// label-related lives here so the two surfaces cannot disagree again; the
// components own only their layout.

export type IssueStatus = "open" | "solving" | "solved" | "dropped";
export type IssuePriority = "urgent" | "high" | "medium" | "low";
export type IssueType = "short" | "long";

// Vote credits are per person (within a team), and stackable on a single issue.
// Enforced for real inside the castVote transaction; surfaced in the UI so
// people can see what they have left. Name is historical ("per team" scope of
// the budget) — each user gets this many credits independently.
export const MAX_VOTES_PER_TEAM = 3;

export const STATUS_ORDER: IssueStatus[] = [
  "open",
  "solving",
  "solved",
  "dropped",
];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Open",
  solving: "Solving",
  solved: "Solved",
  dropped: "Dropped",
};

export const STATUS_BADGE: Record<IssueStatus, string> = {
  open: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300",
  solving:
    "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300",
  solved:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
  dropped:
    "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_BADGE: Record<IssuePriority, string> = {
  urgent:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-300",
  medium:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

export function priorityRank(p: IssuePriority | null | undefined): number {
  const idx = p ? PRIORITY_ORDER.indexOf(p) : -1;
  return idx === -1 ? PRIORITY_ORDER.length : idx;
}

function statusRank(s: IssueStatus | null | undefined): number {
  const idx = s ? STATUS_ORDER.indexOf(s) : -1;
  return idx === -1 ? STATUS_ORDER.length : idx;
}

// The minimum shape the ranking rules need. Both surfaces pass richer docs.
export type RankableIssue = {
  id: string;
  type?: IssueType | null;
  status?: IssueStatus | null;
  priority?: IssuePriority | null;
  votes?: number | null;
};

// Short-term issues are the short-term list; long-term are parked below it. An issue
// with no type recorded is treated as short-term, matching QuickAddIssue,
// which stamps "short" on everything dropped from a meeting stage.
export function splitIssuesByTerm<T extends RankableIssue>(
  issues: T[],
): { short: T[]; long: T[] } {
  const short: T[] = [];
  const long: T[] = [];
  for (const issue of issues) {
    if (issue.type === "long") long.push(issue);
    else short.push(issue);
  }
  return { short, long };
}

// Short-term ranking: whatever the group is discussing pins to the very top
// for everyone, then unresolved issues, then the team's vote total. Votes
// outrank priority here by design — the team's votes are what decide where
// the Issues hour goes; priority stays a label.
export function rankShortTerm<T extends RankableIssue>(
  issues: T[],
  discussingId?: string | null,
): T[] {
  return [...issues].sort((a, b) => {
    if (discussingId) {
      if (a.id === discussingId) return -1;
      if (b.id === discussingId) return 1;
    }
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return (b.votes ?? 0) - (a.votes ?? 0);
  });
}

// Long-term issues aren't votable, so they fall back to the priority gate,
// then status. Callers append their own stable tiebreak (e.g. created_at).
export function rankLongTerm<T extends RankableIssue>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    if (byPriority !== 0) return byPriority;
    return statusRank(a.status) - statusRank(b.status);
  });
}

// Tallies one user's spent credits from their own issue_votes docs. Both
// surfaces subscribe to the caller's votes only, so this never sees other
// people's rows — the team total lives denormalized on the issue itself.
export function voteCredits(
  votes: { issue_id: string; count?: number | null }[],
  max: number = MAX_VOTES_PER_TEAM,
): { byIssue: Map<string, number>; used: number; remaining: number } {
  const byIssue = new Map<string, number>();
  let used = 0;
  for (const v of votes) {
    const count = Number(v.count ?? 1);
    if (!Number.isFinite(count) || count <= 0) continue;
    byIssue.set(v.issue_id, count);
    used += count;
  }
  return { byIssue, used, remaining: Math.max(0, max - used) };
}

/**
 * Room-wide vote tally for the L10 Issues header.
 *
 * Client ask (Steph, 8/19 L10): "we always ask everyone if they voted ... it
 * might be cool to just tally up if the available votes have been exhausted
 * or not, because then you don't have to confirm that everybody has submitted
 * their three votes."
 *
 * Cast comes from the team totals denormalized on each issue, so this needs no
 * read of other people's `issue_votes` (which no client subscribes to).
 * Available counts only the people actually in the room — absentees are never
 * going to spend theirs, and a denominator that can't be reached would defeat
 * the whole point of the chip.
 */
export function teamVoteTally(
  issues: { votes?: number | null }[],
  presentVoterCount: number,
  max: number = MAX_VOTES_PER_TEAM,
): { cast: number; available: number; allIn: boolean; label: string; detail: string } {
  let cast = 0;
  for (const i of issues) {
    const n = Number(i.votes ?? 0);
    if (Number.isFinite(n) && n > 0) cast += n;
  }
  const available = Math.max(0, presentVoterCount) * max;
  // Never claim "all in" on an empty room — 0 of 0 is not a finished vote.
  const allIn = available > 0 && cast >= available;
  const label = allIn ? "All votes in" : `${cast} of ${available} votes cast`;
  const detail = allIn
    ? `Everyone in the room has spent all ${max} of their credits.`
    : `${cast} of ${available} credits spent — ${presentVoterCount} ${
        presentVoterCount === 1 ? "person" : "people"
      } in the room x ${max} each. Absentees are not counted.`;
  return { cast, available, allIn, label, detail };
}

/** User-facing copy for the remaining-credits chip (L10 Issues header). */
export function voteCreditsSummary(
  used: number,
  max: number = MAX_VOTES_PER_TEAM,
): {
  remaining: number;
  /** Short label, e.g. "3 of 3 left" / "0 left" */
  label: string;
  /** Longer explanation for title/tooltip */
  detail: string;
  depleted: boolean;
} {
  const remaining = Math.max(0, max - Math.max(0, used));
  const depleted = remaining === 0;
  const label =
    remaining === 0
      ? `0 of ${max} left`
      : remaining === max
        ? `${max} of ${max} left`
        : `${remaining} of ${max} left`;
  const detail = depleted
    ? `You've used all ${max} of your vote credits. Remove a vote to free one up. Credits are per person and reset when the meeting ends.`
    : `You have ${remaining} of ${max} vote credits left (${used} used). Each person gets ${max} credits; stack them on one issue or spread them. Credits reset when the meeting ends.`;
  return { remaining, label, detail, depleted };
}
