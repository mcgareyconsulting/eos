"use client";

import { useState } from "react";
import { ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailModal } from "@/components/detail-modal";
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

export function IssueDetailTrigger({
  issue,
  ownerName,
  className,
  children,
}: {
  issue: IssueDetailData;
  ownerName: string;
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
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function IssueDetailModal({
  issue,
  ownerName,
  onClose,
}: {
  issue: IssueDetailData;
  ownerName: string;
  onClose: () => void;
}) {
  return (
    <DetailModal ariaLabel={`Issue: ${issue.title}`} onClose={onClose}>
      <div className="space-y-4 pr-6">
        <header>
          <h2 className="text-base font-semibold leading-snug">
            {issue.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {issue.priority && (
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                  PRIORITY_BADGE[issue.priority],
                )}
              >
                {PRIORITY_LABEL[issue.priority]}
              </span>
            )}
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                STATUS_BADGE[issue.status],
              )}
            >
              {STATUS_LABEL[issue.status]}
            </span>
            <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
              {issue.type === "long" ? "Long-term" : "Short-term"}
            </span>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
              Owner
            </dt>
            <dd className="mt-0.5 inline-flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[9px] font-semibold text-hpb-blue ring-1 ring-inset ring-hpb-blue/30 dark:bg-hpb-gold/15 dark:text-hpb-gold dark:ring-hpb-gold/30">
                {initials(ownerName) || "?"}
              </span>
              {ownerName}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
              Votes
            </dt>
            <dd className="mt-0.5 inline-flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
              <ThumbsUp className="h-3.5 w-3.5 text-zinc-500" />
              <span className="tabular-nums">{issue.votes ?? 0}</span>
              {issue.type === "long" && (
                <span className="text-xs text-zinc-500">(not voted on)</span>
              )}
            </dd>
          </div>
        </dl>

        {issue.description && issue.description.trim().length > 0 ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Description
            </h3>
            <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {issue.description}
            </p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No description.</p>
        )}
      </div>
    </DetailModal>
  );
}
