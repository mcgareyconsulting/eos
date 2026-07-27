"use client";

import { useMemo } from "react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { Trash2, AlertCircle, User } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  MAX_VOTES_PER_TEAM,
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  rankLongTerm,
  rankShortTerm,
  splitIssuesByTerm,
  voteCredits,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@/lib/issues";
import { StatusActions } from "./status-actions";
import { EditIssuePopover } from "./edit-issue-popover";
import { VoteButton } from "./vote-button";
import { deleteIssue } from "./actions";

export type IssueDoc = {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: IssuePriority | null;
  votes: number;
  type: IssueType;
  status: IssueStatus;
};

export type VoteDoc = { id: string; issue_id: string; count?: number | null };

type Member = { user_id: string; full_name: string };

// The Issues tab, live. Votes used to be castable only inside the L10 IDS
// segment, which meant the list here was a static snapshot ranked by
// priority. It now subscribes to the same two queries the meeting uses, so
// voting works outside a meeting and every client re-ranks the moment anyone
// votes — the team total lives denormalized on the issue doc, so one
// subscription drives the ordering for everybody.
export function IssuesList({
  teamId,
  userId,
  members,
  initialIssues,
  initialVotes,
}: {
  teamId: string;
  userId: string;
  members: Member[];
  initialIssues: IssueDoc[];
  initialVotes: VoteDoc[];
}) {
  const db = getClientDb();

  const issuesQuery = useMemo(
    () => fsQuery(collection(db, "issues"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  // Only ever our own vote rows — enough to show remaining credits and which
  // issues we backed. Everyone else's votes arrive via issues.votes.
  const votesQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "issue_votes"),
        where("user_id", "==", userId),
        where("team_id", "==", teamId),
      ),
    [db, teamId, userId],
  );

  const issues = useCollection<IssueDoc>(issuesQuery, initialIssues, "issues");
  const votes = useCollection<VoteDoc>(votesQuery, initialVotes, "issue-votes");

  const { byIssue, used, remaining } = voteCredits(votes);
  const { short, long } = splitIssuesByTerm(issues);
  const rankedShort = rankShortTerm(short);
  const rankedLong = rankLongTerm(long);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  if (issues.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <EmptyState
          icon={AlertCircle}
          title="No issues yet"
          hint="Capture team blockers above, then vote to rank them and solve the top ones in the L10 Issues segment."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">
            Short-term
            <span className="ml-2 text-xs font-normal text-zinc-600 dark:text-zinc-400">
              {rankedShort.length} · ranked by team votes
            </span>
          </h2>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            <span
              className={
                "font-medium " +
                (remaining === 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-700 dark:text-zinc-300")
              }
            >
              {used}/{MAX_VOTES_PER_TEAM}
            </span>{" "}
            of your votes used
            {remaining === 0
              ? " · out of votes — tap − on an issue to re-allocate"
              : ` · stack up to ${MAX_VOTES_PER_TEAM} on a single issue`}
          </div>
        </div>
        <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {rankedShort.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
              No short-term issues.
            </div>
          )}
          {rankedShort.map((issue) => (
            <IssueRow
              key={issue.id}
              teamId={teamId}
              issue={issue}
              members={members}
              ownerName={ownerName}
              vote={{
                myCount: byIssue.get(issue.id) ?? 0,
                myRemaining: remaining,
              }}
            />
          ))}
        </div>
      </section>

      {/* Long-term issues are parked below the IDS list and aren't votable —
          vote credits exist to rank the hour the team actually spends. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">
            Long-term
            <span className="ml-2 text-xs font-normal text-zinc-600 dark:text-zinc-400">
              {rankedLong.length} · ranked by priority · not voted on
            </span>
          </h2>
        </div>
        <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {rankedLong.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
              No long-term issues.
            </div>
          )}
          {rankedLong.map((issue) => (
            <IssueRow
              key={issue.id}
              teamId={teamId}
              issue={issue}
              members={members}
              ownerName={ownerName}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function IssueRow({
  teamId,
  issue,
  members,
  ownerName,
  vote,
}: {
  teamId: string;
  issue: IssueDoc;
  members: Member[];
  ownerName: (id: string | null) => string;
  vote?: { myCount: number; myRemaining: number };
}) {
  const remove = deleteIssue.bind(null, teamId, issue.id);

  return (
    <div className="group flex items-start gap-3 px-4 py-3 text-sm">
      {vote ? (
        <div className="w-12 shrink-0 pt-0.5">
          <VoteButton
            teamId={teamId}
            issueId={issue.id}
            count={issue.votes ?? 0}
            myCount={vote.myCount}
            myRemaining={vote.myRemaining}
          />
        </div>
      ) : (
        <div className="w-12 shrink-0 pt-0.5" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {issue.priority && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PRIORITY_BADGE[issue.priority]}`}
            >
              {PRIORITY_LABEL[issue.priority]}
            </span>
          )}
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[issue.status]}`}
          >
            {STATUS_LABEL[issue.status]}
          </span>
        </div>
        <div className="mt-1 font-medium">{issue.title}</div>
        {issue.description && (
          <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
            {issue.description}
          </div>
        )}
        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          <User className="h-3 w-3" />
          {ownerName(issue.owner_id)}
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <EditIssuePopover
          teamId={teamId}
          issueId={issue.id}
          members={members}
          ownerId={issue.owner_id}
          priority={issue.priority}
          description={issue.description}
        />
        <StatusActions teamId={teamId} issueId={issue.id} status={issue.status} />
        <form action={remove}>
          <button
            type="submit"
            className="text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
            aria-label="Delete issue"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
