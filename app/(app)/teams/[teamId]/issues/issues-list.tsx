"use client";

import { useMemo } from "react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { Trash2, AlertCircle, User, ThumbsUp } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  rankLongTerm,
  rankShortTerm,
  splitIssuesByTerm,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@/lib/issues";
import { EditIssuePopover } from "./edit-issue-popover";
import { IssueDetailTrigger } from "./issue-detail-modal";
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

type Member = { user_id: string; full_name: string };

// Issues tab: capture, edit, and triage outside the meeting. Voting is L10-only
// (see segment-ids.tsx). We still rank short-term by the denormalized team vote
// total so the list mirrors meeting order as a read-only view.
export function IssuesList({
  teamId,
  members,
  initialIssues,
}: {
  teamId: string;
  members: Member[];
  initialIssues: IssueDoc[];
}) {
  const db = getClientDb();

  const issuesQuery = useMemo(
    () => fsQuery(collection(db, "issues"), where("team_id", "==", teamId)),
    [db, teamId],
  );

  const issues = useCollection<IssueDoc>(issuesQuery, initialIssues, "issues");

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
          hint="Capture team blockers above. Vote and solve the top ones during the L10 Issues segment."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header className="border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Short-term
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {rankedShort.length} issue{rankedShort.length === 1 ? "" : "s"} ·
            ordered by L10 team votes · vote only in the meeting
          </p>
        </header>
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
              showVoteCount
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <header className="border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Long-term
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {rankedLong.length} issue{rankedLong.length === 1 ? "" : "s"} ·
            ranked by priority · not voted on
          </p>
        </header>
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
  showVoteCount = false,
}: {
  teamId: string;
  issue: IssueDoc;
  members: Member[];
  ownerName: (id: string | null) => string;
  showVoteCount?: boolean;
}) {
  const remove = deleteIssue.bind(null, teamId, issue.id);

  const hasDescription =
    !!issue.description && issue.description.trim().length > 0;

  return (
    <div className="group flex items-center gap-3 px-4 py-3 text-sm">
      {showVoteCount && (
        <div
          className="flex w-12 shrink-0 flex-col items-center gap-0.5 rounded-md bg-zinc-50 px-1.5 py-1 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950/50 dark:ring-zinc-800"
          title="Team votes from L10 (read-only — vote in the meeting)"
        >
          <ThumbsUp className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
            {Number(issue.votes ?? 0)}
          </span>
        </div>
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
          {hasDescription && (
            <span className="text-[11px] text-zinc-400">Has description</span>
          )}
        </div>
        <IssueDetailTrigger
          issue={issue}
          ownerName={ownerName(issue.owner_id)}
          className="mt-1 block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold"
        >
          {issue.title}
        </IssueDetailTrigger>
        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          <User className="h-3 w-3" />
          {ownerName(issue.owner_id)}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <EditIssuePopover
          teamId={teamId}
          issueId={issue.id}
          members={members}
          ownerId={issue.owner_id}
          priority={issue.priority}
          description={issue.description}
        />
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
