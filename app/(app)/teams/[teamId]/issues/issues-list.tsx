"use client";

import { useMemo, useState } from "react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import {
  Trash2,
  AlertCircle,
  User,
  ThumbsUp,
  Pencil,
  Archive,
} from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { EmptyState } from "@/components/empty-state";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { cn } from "@/lib/utils";
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
import { IssueDetailTrigger } from "./issue-detail-modal";
import { IssueFormModal } from "./issue-form-modal";
import { MoveIssueTermButton } from "./move-term-button";
import { deleteIssue, setIssueArchived } from "./actions";
import { ownerLabel } from "@/lib/user-name";

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
  archived?: boolean;
  closed_on?: string | null;
  /** Live client docs may carry Firestore Timestamp. */
  archived_at?: unknown;
};

type Member = { user_id: string; full_name: string };
type TermTab = "short" | "long";

function isClosedStatus(status: IssueStatus | null | undefined): boolean {
  return status === "solved" || status === "dropped";
}

function isArchivedIssue(i: IssueDoc): boolean {
  return i.archived === true || i.archived_at != null;
}

// Issues tab: capture, edit, and triage outside the meeting. Voting is L10-only.
export function IssuesList({
  teamId,
  userId,
  members,
  initialIssues,
  showArchived = false,
  ownerFilter = "all",
}: {
  teamId: string;
  userId: string;
  members: Member[];
  initialIssues: IssueDoc[];
  showArchived?: boolean;
  ownerFilter?: string;
}) {
  const db = getClientDb();
  const [tab, setTab] = useState<TermTab>("short");
  const [editing, setEditing] = useState<IssueDoc | null>(null);

  const issuesQuery = useMemo(
    () => fsQuery(collection(db, "issues"), where("team_id", "==", teamId)),
    [db, teamId],
  );

  const live = useCollection<IssueDoc>(issuesQuery, initialIssues, "issues");
  const issues = live.filter((i) => {
    const inView = showArchived ? isArchivedIssue(i) : !isArchivedIssue(i);
    if (!inView) return false;
    if (ownerFilter === "all") return true;
    return i.owner_id === ownerFilter;
  });

  const { short, long } = splitIssuesByTerm(issues);
  const rankedShort = rankShortTerm(short);
  const rankedLong = rankLongTerm(long);
  const list = tab === "short" ? rankedShort : rankedLong;

  const ownerName = (id: string | null) =>
    ownerLabel(id, (x) => members.find((m) => m.user_id === x)?.full_name);

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
      </div>

      {issues.length === 0 ? (
        <div className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <EmptyState
            icon={showArchived ? Archive : AlertCircle}
            title={showArchived ? "No archived issues" : "No issues yet"}
            hint={
              showArchived
                ? "Solved/dropped in an L10 archive at Finish; other closes archive Monday morning."
                : "Use Add issue to capture blockers. Vote and solve the top ones during the L10 Issues segment."
            }
          />
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {list.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
              {tab === "short"
                ? "No short-term issues. Move one from long-term or add one."
                : "No long-term issues. Move one from short-term or add one."}
            </div>
          )}
          {list.map((issue) => (
            <IssueRow
              key={issue.id}
              teamId={teamId}
              userId={userId}
              issue={issue}
              members={members}
              ownerName={ownerName}
              showVoteCount={tab === "short" && !showArchived}
              showArchived={showArchived}
              onEdit={() => setEditing(issue)}
            />
          ))}
        </div>
      )}

      {editing && !showArchived && (
        <IssueFormModal
          teamId={teamId}
          members={members}
          defaultOwnerId={userId}
          defaultType={editing.type === "long" ? "long" : "short"}
          issue={editing}
          open={!!editing}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          showTrigger={false}
        />
      )}
    </div>
  );
}

function IssueRow({
  teamId,
  userId,
  issue,
  members,
  ownerName,
  showVoteCount = false,
  showArchived = false,
  onEdit,
}: {
  teamId: string;
  userId: string;
  issue: IssueDoc;
  members: Member[];
  ownerName: (id: string | null) => string;
  showVoteCount?: boolean;
  showArchived?: boolean;
  onEdit: () => void;
}) {
  const remove = deleteIssue.bind(null, teamId, issue.id);
  const archived = showArchived || isArchivedIssue(issue);
  const closedPending = !archived && isClosedStatus(issue.status);
  const toggleArchive = setIssueArchived.bind(
    null,
    teamId,
    issue.id,
    !archived,
  );

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3 text-sm",
        closedPending && "bg-zinc-50/90 text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400",
      )}
    >
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
          {closedPending && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400">
              Closes Monday
            </span>
          )}
        </div>
        <IssueDetailTrigger
          issue={issue}
          ownerName={ownerName(issue.owner_id)}
          teamId={teamId}
          userId={userId}
          members={members}
          className={cn(
            "mt-1 block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold",
            closedPending && "text-zinc-500 dark:text-zinc-400",
            archived && "font-normal text-zinc-700 dark:text-zinc-300",
          )}
        >
          {issue.title}
        </IssueDetailTrigger>
        {archived && (
          <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
            Closed On: {issue.closed_on ?? "—"}
          </div>
        )}
        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          <User className="h-3 w-3" />
          {ownerName(issue.owner_id)}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!archived && (
          <MoveIssueTermButton
            teamId={teamId}
            issueId={issue.id}
            type={issue.type}
          />
        )}
        {!archived && (
          <button
            type="button"
            onClick={onEdit}
            title="Edit issue"
            aria-label="Edit issue"
            className="rounded p-1 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        <form action={toggleArchive}>
          <button
            type="submit"
            className="rounded p-1 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label={archived ? "Restore issue" : "Archive issue"}
            title={archived ? "Restore to Active" : "Archive now"}
          >
            <Archive className="h-4 w-4" />
          </button>
        </form>
        {!archived && (
          <ConfirmSubmitForm
            action={remove}
            confirmMessage="Delete this issue? This will also delete its votes and comments. This can't be undone."
          >
            <button
              type="submit"
              className="text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
              aria-label="Delete issue"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </ConfirmSubmitForm>
        )}
      </div>
    </div>
  );
}
