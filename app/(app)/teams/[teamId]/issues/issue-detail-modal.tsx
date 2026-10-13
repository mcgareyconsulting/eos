"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Pencil, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "@/components/activity-feed";
import { DetailShell } from "@/components/detail-shell";
import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import {
  DiscardChangesDialog,
  useDiscardGuard,
} from "@/components/ui/modal";
import { initials } from "@/lib/user-name";
import { useHydrated } from "@/lib/use-hydrated";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  isArchivedIssue,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@/lib/issues";
import { IssueFormModal } from "./issue-form-modal";
import { issueEventsFromDoc, type IssueEventSource } from "./issue-events";

// Plain-data props (owner name pre-resolved) so this works from any surface —
// see rock-detail-modal.tsx for the pattern rationale. The IssueEventSource
// fields (created_at, resolved_at, …) are optional: callers hand over the
// live doc, which carries them once the listener has delivered.
export type IssueDetailData = IssueEventSource & {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: IssuePriority | null;
  votes: number;
  type: IssueType;
  status: IssueStatus;
  /** Legacy archived flag (see isArchivedIssue). */
  archived?: boolean | null;
};

type Member = { user_id: string; full_name: string };

export function IssueDetailTrigger({
  issue,
  ownerName,
  teamId,
  userId,
  members,
  className,
  children,
  deepLink = false,
}: {
  issue: IssueDetailData;
  ownerName: string;
  teamId: string;
  userId: string;
  members: Member[];
  className?: string;
  children: React.ReactNode;
  /**
   * Open on arrival when the URL says `?issue=<this id>` (the link a
   * notification carries). Set on the one trigger per issue the page
   * renders, not on every surface.
   */
  deepLink?: boolean;
}) {
  const linked = useSearchParams().get("issue") === issue.id;
  const [open, setOpen] = useState(deepLink && linked);
  // The detail portals to <body>, which a deep link's server render doesn't
  // have; it opens on hydration instead.
  const hydrated = useHydrated();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View issue"
        className={className}
      >
        {children}
      </button>
      {open && hydrated && (
        <IssueDetailModal
          issue={issue}
          ownerName={ownerName}
          teamId={teamId}
          userId={userId}
          members={members}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function IssueDetailModal({
  issue,
  ownerName,
  teamId,
  userId,
  members,
  onClose,
}: {
  issue: IssueDetailData;
  ownerName: string;
  teamId: string;
  userId: string;
  members: Member[];
  onClose: () => void;
}) {
  const hasDescription =
    !!issue.description && issue.description.trim().length > 0;
  // Same rule as the Issues page row: an archived issue isn't edited.
  const canEdit = !isArchivedIssue(issue);
  const [editing, setEditing] = useState(false);

  // Closing with an unsent comment asks first, as the edit forms do.
  // Backdrop, Escape and × all route through the guard.
  const [hasDraft, setHasDraft] = useState(false);
  const guard = useDiscardGuard(hasDraft, onClose);

  const nameOf = useCallback(
    (uid: string) => members.find((m) => m.user_id === uid)?.full_name,
    [members],
  );
  // Only what the doc can prove (created / solved or dropped / archived);
  // issue-events.ts lists what waits on an issue activity trace.
  const events = useMemo(
    () => issueEventsFromDoc(issue, nameOf),
    [issue, nameOf],
  );

  return (
    <>
      <DetailShell
        ariaLabel={`Issue: ${issue.title}`}
        onClose={guard.requestClose}
        // Escape belongs to the discard confirm while it is up.
        dismissible={!guard.asking}
        aside={
          <ActivityFeed
            teamId={teamId}
            entityType="issue"
            entityId={issue.id}
            userId={userId}
            members={members}
            events={events}
            onDraftChange={setHasDraft}
          />
        }
      >
        <div className="space-y-6">
          <header className="space-y-3">
            <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
              {issue.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {issue.priority && (
                <span
                  className={cn(
                    "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    PRIORITY_BADGE[issue.priority],
                  )}
                >
                  {PRIORITY_LABEL[issue.priority]}
                </span>
              )}
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                  STATUS_BADGE[issue.status],
                )}
              >
                {STATUS_LABEL[issue.status]}
              </span>
              <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
                {issue.type === "long" ? "Long-term" : "Short-term"}
              </span>
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={() => setEditing(true)}
                  className="ml-auto h-7 px-2.5 text-xs"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Edit
                </Button>
              )}
            </div>
          </header>

          <section
            aria-label="Issue details"
            className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40"
          >
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Owner
                </dt>
                <dd className="mt-1 inline-flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue ring-1 ring-inset ring-hpb-blue/30 dark:bg-hpb-gold/15 dark:text-hpb-gold dark:ring-hpb-gold/30">
                    {initials(ownerName) || "?"}
                  </span>
                  <span className="font-medium">{ownerName}</span>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Votes
                </dt>
                <dd className="mt-1 inline-flex items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-200">
                  <ThumbsUp className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="tabular-nums font-medium">
                    {issue.votes ?? 0}
                  </span>
                  {issue.type === "long" && (
                    <span className="text-xs text-zinc-500">(not voted on)</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Description
            </h3>
            {hasDescription ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                <RichText
                  value={issue.description}
                  className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No description.</p>
            )}
          </section>
        </div>
      </DetailShell>

      {/* Edit stays its own dialog (like Rock). Portalled to <body> after the
          detail's own portal, so it is the later — topmost — dialog in the
          document: it paints over the detail, and Escape goes to the form
          (through its discard guard) while the detail, no longer topmost,
          ignores the key. Closing the form lands back on the detail, which
          reads the same live doc and so shows the saved values. */}
      {editing &&
        createPortal(
          <IssueFormModal
            teamId={teamId}
            members={members}
            defaultOwnerId={userId}
            defaultType={issue.type === "long" ? "long" : "short"}
            issue={issue}
            open
            onOpenChange={(next) => {
              if (!next) setEditing(false);
            }}
            showTrigger={false}
          />,
          document.body,
        )}

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        title="Discard your comment?"
        message="You have a comment you haven't posted. Close now and it's gone."
        discardLabel="Discard comment"
      />
    </>
  );
}
