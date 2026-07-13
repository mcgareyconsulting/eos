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
import { VoteButton } from "../../issues/vote-button";
import { StatusActions } from "../../issues/status-actions";
import { deleteIssue } from "../../issues/actions";
import { setDiscussingIssue } from "../actions";
import { QuickAddIssue } from "@/components/quick-add-issue";

type IssueDoc = {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  votes: number;
  type: "short" | "long";
  status: "open" | "solving" | "solved" | "dropped";
};

type VoteDoc = {
  id: string;
  issue_id: string;
  user_id: string;
  team_id: string;
  count: number;
};

type Member = { user_id: string; full_name: string };

const STATUS_LABEL: Record<IssueDoc["status"], string> = {
  open: "Open",
  solving: "Solving",
  solved: "Solved",
  dropped: "Dropped",
};

const STATUS_BADGE: Record<IssueDoc["status"], string> = {
  open: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300",
  solving:
    "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300",
  solved:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
  dropped:
    "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_ORDER = ["open", "solving", "solved", "dropped"];

// Display-only — ranking during the meeting stays vote-based (see `sorted`
// below). This mirrors the priority badge shown on the standalone Issues tab.
const PRIORITY_LABEL: Record<
  NonNullable<IssueDoc["priority"]>,
  string
> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const PRIORITY_BADGE: Record<NonNullable<IssueDoc["priority"]>, string> = {
  urgent:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-300",
  medium:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

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

  const myVoteByIssue = new Map<string, number>();
  let myVotesUsed = 0;
  for (const v of votes) {
    const c = Number(v.count ?? 1);
    myVoteByIssue.set(v.issue_id, c);
    myVotesUsed += c;
  }
  const myVotesRemaining = Math.max(0, 3 - myVotesUsed);

  const sorted = [...issues].sort((a, b) => {
    // The issue being discussed pins to the very top for everyone.
    if (a.id === discussingId) return -1;
    if (b.id === discussingId) return 1;
    const byStatus =
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
    return (b.votes ?? 0) - (a.votes ?? 0);
  });

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
            {myVotesUsed}/3
          </span>{" "}
          of your votes used
          {myVotesRemaining === 0
            ? " · out of votes — tap − on an issue to re-allocate"
            : " · stack up to 3 on a single issue"}{" "}
          · sorted by team votes
        </div>
        <QuickAddIssue teamId={teamId} compact />
      </div>

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {sorted.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No issues yet. Drop one from any segment.
          </div>
        )}
        {sorted.map((i) => {
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
                  <span className="text-xs text-zinc-500">
                    {i.type === "long" ? "Long-term" : "Short-term"}
                  </span>
                </div>
                <div className="mt-1 font-medium">{i.title}</div>
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
                <form action={remove}>
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
    </div>
  );
}
