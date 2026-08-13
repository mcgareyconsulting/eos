"use client";

import { useMemo, useState } from "react";
import { Archive, Trash2, Megaphone, Pencil, User, AlertCircle } from "lucide-react";
import {
  collection,
  doc,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { EmptyState } from "@/components/empty-state";
import { EntityViewToggle } from "@/components/entity-view-toggle";
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
import { IssueFormModal } from "../../issues/issue-form-modal";
import { MoveIssueTermButton } from "../../issues/move-term-button";
import { deleteIssue, setIssueArchived } from "../../issues/actions";
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
  archived?: boolean;
  archived_at?: unknown;
};

function isArchivedIssue(i: IssueDoc): boolean {
  return i.archived === true || i.archived_at != null;
}

// Same M/D/YYYY the standalone tab shows; live docs carry a client
// Timestamp, legacy `archived: true` docs may have no archived_at at all.
function formatClosedOn(archived_at: unknown): string | null {
  const t = archived_at as
    | { toDate?: () => Date; toMillis?: () => number }
    | null
    | undefined;
  if (t == null) return null;
  let d: Date | null = null;
  if (typeof t.toDate === "function") d = t.toDate();
  else if (typeof t.toMillis === "function") d = new Date(t.toMillis());
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

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
  const [showArchived, setShowArchived] = useState(false);
  const [editingIssue, setEditingIssue] = useState<IssueDoc | null>(null);

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

  // Active vs archived split — counts span both terms, matching the standalone.
  const activeIssues = issuesLive.filter((i) => !isArchivedIssue(i));
  const archivedIssues = issuesLive.filter(isArchivedIssue);
  const viewIssues = showArchived ? archivedIssues : activeIssues;

  // Short-term is what the Issues hour works; long-term is parked on its own tab.
  const { short, long } = splitIssuesByTerm(viewIssues);
  const rankedShort = rankShortTerm(short, showArchived ? null : discussingId);
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
          <EntityViewToggle
            showArchived={showArchived}
            onChange={setShowArchived}
            activeCount={activeIssues.length}
            archivedCount={archivedIssues.length}
          />
          {!showArchived && tab === "short" && (
            <VoteCreditsBadge used={myVotesUsed} />
          )}
          {!showArchived && tab === "long" && (
            <span className="text-xs text-zinc-500">
              Not votable · move to short-term to work this meeting
            </span>
          )}
          <QuickAddIssue teamId={teamId} meetingId={meetingId} />
        </div>
      </div>

      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {list.length === 0 && showArchived && (
          <EmptyState
            icon={Archive}
            title={
              tab === "short"
                ? "No archived short-term issues"
                : "No archived long-term issues"
            }
            hint="Restore one to bring it back to Active."
          />
        )}
        {list.length === 0 && !showArchived && (
          <EmptyState
            icon={AlertCircle}
            title={
              tab === "short" ? "No short-term issues" : "No long-term issues"
            }
            hint={
              tab === "short"
                ? "Drop one from any segment or move from long-term."
                : "Move one from short-term to park it."
            }
          />
        )}
        {showArchived &&
          list.map((i) => (
            <div
              key={i.id}
              className="group flex items-center gap-3 px-4 py-3 text-sm"
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
                  teamId={teamId}
                  userId={userId}
                  members={members}
                  className="mt-1 block max-w-full truncate text-left font-normal text-zinc-700 hover:text-hpb-blue dark:text-zinc-300 dark:hover:text-hpb-gold"
                >
                  {i.title}
                </IssueDetailTrigger>
                <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
                  Closed On: {formatClosedOn(i.archived_at) ?? "—"}
                </div>
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  <User className="h-3 w-3" />
                  {ownerName(i.owner_id)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <form action={setIssueArchived.bind(null, teamId, i.id, false)}>
                  <button
                    type="submit"
                    className="rounded p-1 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800"
                    aria-label="Restore issue"
                    title="Restore to Active"
                  >
                    <Archive className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </div>
          ))}
        {!showArchived &&
          list.map((i) => {
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
                    {closedPending && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400">
                        Closes Monday
                      </span>
                    )}
                  </div>
                  <IssueDetailTrigger
                    issue={i}
                    ownerName={ownerName(i.owner_id)}
                    teamId={teamId}
                    userId={userId}
                    members={members}
                    className={
                      "mt-1 block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold " +
                      (closedPending ? "text-zinc-500 dark:text-zinc-400" : "")
                    }
                  >
                    {i.title}
                  </IssueDetailTrigger>
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    <User className="h-3 w-3" />
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
                  <button
                    type="button"
                    onClick={() => setEditingIssue(i)}
                    title="Edit issue"
                    aria-label="Edit issue"
                    className="rounded p-1 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <StatusActions
                    teamId={teamId}
                    issueId={i.id}
                    status={i.status}
                  />
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
                </div>
              </div>
            );
          })}
      </div>

      {editingIssue && (
        <IssueFormModal
          teamId={teamId}
          members={members}
          defaultOwnerId={userId}
          defaultType={editingIssue.type === "long" ? "long" : "short"}
          issue={editingIssue}
          open={!!editingIssue}
          onOpenChange={(next) => {
            if (!next) setEditingIssue(null);
          }}
          showTrigger={false}
        />
      )}
    </div>
  );
}
