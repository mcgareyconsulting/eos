"use client";

import { useMemo, useState } from "react";
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
import { VoteCreditsBadge } from "../../issues/vote-credits-badge";
import { StatusActions } from "../../issues/status-actions";
import { IssueDetailTrigger } from "../../issues/issue-detail-modal";
import { MoveIssueTermButton } from "../../issues/move-term-button";
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
  archived_at?: unknown;
};

type VoteDoc = {
  id: string;
  issue_id: string;
  user_id: string;
  team_id: string;
  count: number;
};

type Member = { user_id: string; full_name: string };
type TermTab = "short" | "long";

export function SegmentIssues({
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
  const [tab, setTab] = useState<TermTab>("short");

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

  const issuesLive = useCollection<IssueDoc>(issuesQuery, initialIssues);
  const votes = useCollection<VoteDoc>(votesQuery, initialVotes);
  // Live "discussing now" pointer, shared across all clients via the meeting doc.
  const meetingLive = useDoc<{ current_issue_id?: string | null }>(
    meetingRef,
    { current_issue_id: initialCurrentIssueId },
  );
  const discussingId = meetingLive.current_issue_id ?? null;

  const { byIssue: myVoteByIssue, used: myVotesUsed, remaining: myVotesRemaining } =
    voteCredits(votes);

  // Active only — archived issues leave the L10 list.
  const issues = issuesLive.filter((i) => i.archived_at == null);

  // Short-term is what the Issues hour works; long-term is parked on its own tab.
  const { short, long } = splitIssuesByTerm(issues);
  const rankedShort = rankShortTerm(short, discussingId);
  const rankedLong = rankLongTerm(long);
  const list = tab === "short" ? rankedShort : rankedLong;

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("short")}
          className={
            tab === "short"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          Short-term ({rankedShort.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("long")}
          className={
            tab === "long"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          Long-term ({rankedLong.length})
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {tab === "short" && <VoteCreditsBadge used={myVotesUsed} />}
          {tab === "long" && (
            <span className="text-xs text-zinc-500">
              Not votable · move to short-term to work this meeting
            </span>
          )}
          <QuickAddIssue teamId={teamId} meetingId={meetingId} />
        </div>
      </div>

      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {list.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {tab === "short"
              ? "No short-term issues. Drop one from any segment or move from long-term."
              : "No long-term issues. Move one from short-term to park it."}
          </div>
        )}
        {list.map((i) => {
          const remove = deleteIssue.bind(null, teamId, i.id);
          const isDiscussing = tab === "short" && i.id === discussingId;
          const toggleDiscuss = setDiscussingIssue.bind(
            null,
            teamId,
            meetingId,
            isDiscussing ? null : i.id,
          );
          const closedPending =
            i.status === "solved" || i.status === "dropped";
          return (
            <div
              key={i.id}
              className={
                "group flex items-center gap-3 px-4 py-3 text-sm " +
                (isDiscussing
                  ? "bg-hpb-blue/5 dark:bg-hpb-blue/10 ring-1 ring-inset ring-hpb-blue/30"
                  : closedPending
                    ? "bg-zinc-50/90 text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400"
                    : "")
              }
            >
              {tab === "short" && (
                <VoteButton
                  teamId={teamId}
                  issueId={i.id}
                  count={i.votes ?? 0}
                  myCount={myVoteByIssue.get(i.id) ?? 0}
                  myRemaining={myVotesRemaining}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
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
                  teamId={teamId}
                  userId={userId}
                  members={members}
                  className="mt-1 block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold"
                >
                  {i.title}
                </IssueDetailTrigger>
                <div className="mt-1 text-xs text-zinc-600">
                  {ownerName(i.owner_id)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {tab === "short" && (
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
                          : "text-zinc-500 opacity-0 hover:text-hpb-blue group-hover:opacity-100")
                      }
                    >
                      <Megaphone className="h-3.5 w-3.5" />
                      {isDiscussing ? "Stop" : "Discuss"}
                    </button>
                  </form>
                )}
                <MoveIssueTermButton
                  teamId={teamId}
                  issueId={i.id}
                  type={i.type}
                />
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
                        "Delete this issue? This will also delete its votes and comments. This can't be undone.",
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
  );
}
