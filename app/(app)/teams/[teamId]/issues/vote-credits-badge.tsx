"use client";

import {
  MAX_VOTES_PER_TEAM,
  teamVoteTally,
  voteCreditsSummary,
} from "@/lib/issues";

/**
 * L10 Issues header chip: remaining credits first (not "used/total"), so
 * people don't read "2/3 votes used" as "I have 2 left".
 */
export function VoteCreditsBadge({
  used,
  max = MAX_VOTES_PER_TEAM,
}: {
  used: number;
  max?: number;
}) {
  const { remaining, label, detail, depleted } = voteCreditsSummary(used, max);

  return (
    <div
      className={
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset " +
        (depleted
          ? "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900"
          : "bg-zinc-50 text-zinc-700 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700")
      }
      title={detail}
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: max }, (_, i) => {
          // Filled = remaining (available); empty = already spent.
          const available = i < remaining;
          return (
            <span
              key={i}
              className={
                "inline-block h-1.5 w-1.5 rounded-full " +
                (available
                  ? depleted
                    ? "bg-amber-500"
                    : "bg-blue-500 dark:bg-blue-400"
                  : "bg-zinc-300 dark:bg-zinc-600")
              }
            />
          );
        })}
      </span>
      <span className="font-medium tabular-nums">{label}</span>
      <span className="text-zinc-500 dark:text-zinc-400">your credits</span>
    </div>
  );
}

/**
 * Room-wide companion to the personal chip: how many of the credits in the
 * room have actually been spent. Replaces going round the table asking "have
 * you voted?" before the Issues hour can start.
 */
export function TeamVoteTallyBadge({
  issues,
  presentVoterCount,
  max = MAX_VOTES_PER_TEAM,
}: {
  issues: { votes?: number | null }[];
  presentVoterCount: number;
  max?: number;
}) {
  const { cast, available, allIn, label, detail } = teamVoteTally(
    issues,
    presentVoterCount,
    max,
  );
  if (available === 0) return null;

  return (
    <div
      className={
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset " +
        (allIn
          ? "bg-hpb-green/10 text-hpb-green ring-hpb-green/30 dark:bg-hpb-green/15"
          : "bg-zinc-50 text-zinc-700 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700")
      }
      title={detail}
    >
      <span
        aria-hidden
        className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
      >
        <span
          className={
            "block h-full rounded-full " +
            (allIn ? "bg-hpb-green" : "bg-blue-500 dark:bg-blue-400")
          }
          style={{
            width: `${Math.min(100, Math.round((cast / available) * 100))}%`,
          }}
        />
      </span>
      <span className="font-medium tabular-nums">{label}</span>
    </div>
  );
}
