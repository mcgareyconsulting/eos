"use client";

import { useState } from "react";
import { ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailModal } from "@/components/detail-modal";
import { EntityComments } from "@/components/entity-comments";
import { RichText } from "@/components/rich-text";
import { initials } from "@/lib/initials";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@/lib/issues";

// Plain-data props (owner name pre-resolved) so this works from any surface —
// see rock-detail-modal.tsx for the pattern rationale.
export type IssueDetailData = {
  id: string;
  title: string;
  description: string | null;
  priority: IssuePriority | null;
  votes: number;
  type: IssueType;
  status: IssueStatus;
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
}: {
  issue: IssueDetailData;
  ownerName: string;
  teamId: string;
  userId: string;
  members: Member[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
      {open && (
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

export function IssueDetailModal({
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

  return (
    <DetailModal ariaLabel={`Issue: ${issue.title}`} onClose={onClose} size="lg">
      <div className="space-y-6 pr-6">
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

        <EntityComments
          teamId={teamId}
          entityType="issue"
          entityId={issue.id}
          userId={userId}
          members={members}
        />
      </div>
    </DetailModal>
  );
}
