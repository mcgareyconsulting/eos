"use client";

import { useMemo } from "react";
import { Trash2, Megaphone } from "lucide-react";
import {
  collection,
  doc,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
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
import { VoteButton } from "../../issues/vote-button";
import { StatusActions } from "../../issues/status-actions";
import { IssueDetailTrigger } from "../../issues/issue-detail-modal";
import { deleteIssue } from "../../issues/actions";
import { setDiscussingIssue } from "../actions";
import { QuickAddIssue } from "@/components/quick-add-issue";

type IssueDoc = {
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

type VoteDoc = {
  id: string;
  issue_id: string;
  user_id: string;
  team_id: string;
  count: number;
};

type Member = { user_id: string; full_name: string };

export function SegmentIDS({
  teamId,
  meetingId,
  userId,
  initialIssues,
  initialVotes,
  initialCurrentIssueId,
  members,
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  initialIssues: IssueDoc[];
  initialVotes: VoteDoc[];
  initialCurrentIssueId: string | null;
  members: Member[];
}) {
  const db = getClientDb();

  const issuesQuery = useMemo(
    () => fsQuery(collection(db, "issues"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  const votesQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "issue_votes"),
        where("user_id", "==", userId),
        where("team_id", "==", teamId),
      ),
    [db, teamId, userId],
  );
  const meetingRef = useMemo(
    () => doc(db, "meetings", meetingId),
    [db, meetingId],
  );

  const issues = useCollection<IssueDoc>(issuesQuery, initialIssues);
  const votes = useCollection<VoteDoc>(votesQuery, initialVotes);
  // Live "discussing now" pointer, shared across all clients via the meeting doc.
  const meetingLive = useDoc<{ current_issue_id?: string | null }>(
    meetingRef,
    { current_issue_id: initialCurrentIssueId },
  );
  const discussingId = meetingLive.current_issue_id ?? null;

  const {
    byIssue: myVoteByIssue,
    used: myVotesUsed,
    remaining: myVotesRemaining,
  } = voteCredits(votes);

  // Short-term is the IDS list the hour actually works; long-term is parked
  // below it so it doesn't compete for attention during the meeting.
  const { short, long } = splitIssuesByTerm(issues);
  const rankedShort = rankShortTerm(short, discussingId);
  const rankedLong = rankLongTerm(long);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          <span
            className={
              "font-medium " +
              (myVotesRemaining === 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-zinc-700 dark:text-zinc-300")
            }
          >
            {myVotesUsed}/{MAX_VOTES_PER_TEAM}
          </span>{" "}
          of your votes used
          {myVotesRemaining === 0
            ? " · out of votes — tap − on an issue to re-allocate"
            : ` · stack up to ${MAX_VOTES_PER_TEAM} on a single issue`}{" "}
          · sorted by team votes
        </div>
        <QuickAddIssue teamId={teamId} meetingId={meetingId} />
      </div>

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {rankedShort.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No short-term issues. Drop one from any segment.
          </div>
        )}
        {rankedShort.map((i) => {
          const remove = deleteIssue.bind(null, teamId, i.id);
          const isDiscussing = i.id === discussingId;
          const toggleDiscuss = setDiscussingIssue.bind(
            null,
            teamId,
            meetingId,
            isDiscussing ? null : i.id,
          );
          return (
            <div
              key={i.id}
              className={
                "group flex items-start gap-3 px-4 py-3 text-sm " +
                (isDiscussing
                  ? "bg-hpb-blue/5 dark:bg-hpb-blue/10 ring-1 ring-inset ring-hpb-blue/30"
                  : "")
              }
            >
              <VoteButton
                teamId={teamId}
                issueId={i.id}
                count={i.votes ?? 0}
                myCount={myVoteByIssue.get(i.id) ?? 0}
                myRemaining={myVotesRemaining}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {isDiscussing && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-hpb-blue px-2 py-0.5 text-xs font-medium text-white">
                      <Megaphone className="h-3 w-3" />
                      Discussing
                    </span>
                  )}
                  {i.priority && (
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PRIORITY_BADGE[i.priority]}`}
                    >
                      {PRIORITY_LABEL[i.priority]}
                    </span>
                  )}
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[i.status]}`}
                  >
                    {STATUS_LABEL[i.status]}
                  </span>
                </div>
                <IssueDetailTrigger
                  issue={i}
                  ownerName={ownerName(i.owner_id)}
                  className="mt-1 block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold"
                >
                  {i.title}
                </IssueDetailTrigger>
                {i.description && (
                  <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    {i.description}
                  </div>
                )}
                <div className="mt-1 text-xs text-zinc-600">
                  {ownerName(i.owner_id)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <form action={toggleDiscuss}>
                  <button
                    type="submit"
                    title={
                      isDiscussing
                        ? "Stop discussing"
                        : "Mark as discussing now"
                    }
                    aria-pressed={isDiscussing}
                    className={
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition " +
                      (isDiscussing
                        ? "bg-hpb-blue/10 text-hpb-blue ring-1 ring-inset ring-hpb-blue/30"
                        : "text-zinc-500 hover:text-hpb-blue opacity-0 group-hover:opacity-100")
                    }
                  >
                    <Megaphone className="h-3.5 w-3.5" />
                    {isDiscussing ? "Stop" : "Discuss"}
                  </button>
                </form>
                <StatusActions
                  teamId={teamId}
                  issueId={i.id}
                  status={i.status}
                />
                <form
                  action={remove}
                  onSubmit={(e) => {
                    if (
                      !window.confirm(
                        "Delete this issue? This can't be undone.",
                      )
                    )
                      e.preventDefault();
                  }}
                >
                  <button
                    type="submit"
                    className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
                    aria-label="Delete issue"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {/* Long-term issues are parked below the IDS list: visible for context,
          but not votable and not part of the hour's ranking. */}
      {rankedLong.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Long-term
            <span className="ml-2 font-normal">
              {rankedLong.length} · parked · ranked by priority
            </span>
          </div>
          <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {rankedLong.map((i) => {
              const remove = deleteIssue.bind(null, teamId, i.id);
              return (
                <div
                  key={i.id}
                  className="group flex items-start gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {i.priority && (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PRIORITY_BADGE[i.priority]}`}
                        >
                          {PRIORITY_LABEL[i.priority]}
                        </span>
                      )}
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[i.status]}`}
                      >
                        {STATUS_LABEL[i.status]}
                      </span>
                    </div>
                    <IssueDetailTrigger
                      issue={i}
                      ownerName={ownerName(i.owner_id)}
                      className="mt-1 block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold"
                    >
                      {i.title}
                    </IssueDetailTrigger>
                    {i.description && (
                      <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                        {i.description}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-zinc-600">
                      {ownerName(i.owner_id)}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusActions
                      teamId={teamId}
                      issueId={i.id}
                      status={i.status}
                    />
                    <form
                  action={remove}
                  onSubmit={(e) => {
                    if (
                      !window.confirm(
                        "Delete this issue? This can't be undone.",
                      )
                    )
                      e.preventDefault();
                  }}
                >
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
            })}
          </div>
        </div>
      )}
    </div>
  );
}
