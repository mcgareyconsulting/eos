"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DetailModal } from "@/components/detail-modal";
import { EntityComments } from "@/components/entity-comments";
import { formatDateOnly, relativeDueLabel } from "@/lib/dates";
import { dueToneClass } from "@/lib/due";
import { Fact } from "./fact";
import {
  ROCK_TYPE_LABELS,
  ROCK_TYPE_STYLES,
  normalizeRockType,
} from "./rock-type";
import {
  STATUS_BAR,
  STATUS_LABELS,
  STATUS_STYLES,
  isRockStatus,
  type RockStatus,
} from "./status";
import {
  MilestoneChecklist,
  type MilestoneSerialized,
} from "./milestone-checklist";
import { type StatusUpdateSerialized } from "./status-history";

// Plain-data shapes only: the trigger renders from both Server Components
// (Rocks tab) and Client Components (L10 Rocks segment), so every prop must
// survive the RSC boundary — names come pre-resolved, never as lookups.
export type RockDetailData = {
  id: string;
  title: string;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
};

export type RockDetailMilestone = {
  id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
  owner_name: string | null;
};

type Member = { user_id: string; full_name: string };

export function RockDetailTrigger({
  teamId,
  userId,
  members,
  rock,
  ownerName,
  milestones,
  statusHistory = [],
  interactiveMilestones = false,
  className,
  children,
}: {
  teamId: string;
  userId: string;
  members: Member[];
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
  statusHistory?: StatusUpdateSerialized[];
  /** Tickable milestone checkboxes. Off in L10, where the rock list is a
   *  read-only review surface — `teamId` alone can't imply this, since
   *  comments need it everywhere. */
  interactiveMilestones?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View rock"
        className={className}
      >
        {children}
      </button>
      {open && (
        <RockDetailModal
          teamId={teamId}
          userId={userId}
          members={members}
          rock={rock}
          ownerName={ownerName}
          milestones={milestones}
          statusHistory={statusHistory}
          interactiveMilestones={interactiveMilestones}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The full record for one rock: identity, the same four-fact strip the expanded
 * row shows, the success criterion, a milestone checklist with progress, and
 * the complete status history as a newest-first timeline.
 */
export function RockDetailModal({
  teamId,
  userId,
  members,
  rock,
  ownerName,
  milestones,
  statusHistory = [],
  interactiveMilestones = false,
  onClose,
}: {
  teamId: string;
  userId: string;
  members: Member[];
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
  statusHistory?: StatusUpdateSerialized[];
  interactiveMilestones?: boolean;
  onClose: () => void;
}) {
  const type = normalizeRockType(rock.rock_type);
  const status: RockStatus | null = isRockStatus(rock.status)
    ? rock.status
    : null;
  const bar = status ? STATUS_BAR[status] : "bg-zinc-300 dark:bg-zinc-700";
  const doneCount = milestones.filter((m) => m.completed).length;
  const pct = milestones.length
    ? Math.round((doneCount / milestones.length) * 100)
    : 0;
  const hasDescription = !!rock.description?.trim();

  // MilestoneChecklist speaks MilestoneSerialized; the detail shapes carry a
  // resolved name rather than an id, which is what owner_label is for.
  const checklist: MilestoneSerialized[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    owner_id: null,
    owner_label: m.owner_name,
    due_date: m.due_date,
    completed: m.completed,
    description: null,
  }));

  return (
    <DetailModal ariaLabel={`Rock: ${rock.title}`} onClose={onClose} size="lg">
      <div className="pr-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
          {ownerName} · {rock.quarter || "—"}
        </div>
        <h2 className="mt-1 text-[19px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
          {rock.title}
        </h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {status && (
            <span
              className={cn(
                "inline-flex h-[22px] items-center rounded-full px-2.5 text-[11px] font-semibold ring-1 ring-inset",
                STATUS_STYLES[status],
              )}
            >
              {STATUS_LABELS[status]}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ring-1 ring-inset",
              ROCK_TYPE_STYLES[type],
            )}
          >
            {ROCK_TYPE_LABELS[type]}
          </span>
        </div>

        <div className="mt-4 flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className={cn("w-[3px] shrink-0", bar)} aria-hidden />
          <dl className="flex flex-1 flex-wrap bg-white dark:bg-zinc-900">
            <Fact label="Owner">{ownerName}</Fact>
            <Fact label="Quarter">{rock.quarter || "—"}</Fact>
            <Fact label="Due">
              <span className="tabular-nums">
                {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
              </span>{" "}
              <span
                className={cn(
                  "font-normal",
                  dueToneClass(rock.due_date, rock.status === "done"),
                )}
              >
                {relativeDueLabel(rock.due_date)}
              </span>
            </Fact>
            <Fact label="Milestones" last>
              {milestones.length === 0
                ? "None"
                : `${doneCount} of ${milestones.length} done`}
            </Fact>
          </dl>
        </div>

        <SectionHeading>Description</SectionHeading>
        {hasDescription ? (
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {rock.description}
          </p>
        ) : (
          <p className="text-[13px] italic text-zinc-400">Not defined yet.</p>
        )}

        <div className="mb-2 mt-5 flex items-center justify-between gap-3">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400">
            Milestones
          </h3>
          {milestones.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="relative block h-[5px] w-[74px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <span
                  className={cn("absolute inset-y-0 left-0", bar)}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="text-[11.5px] font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
                {doneCount}/{milestones.length}
              </span>
            </div>
          )}
        </div>
        {milestones.length === 0 ? (
          <p className="text-[13px] italic text-zinc-400">No milestones yet.</p>
        ) : (
          <MilestoneChecklist
            teamId={interactiveMilestones ? teamId : undefined}
            milestones={checklist}
            variant="modal"
          />
        )}

        <SectionHeading>Status history</SectionHeading>
        {statusHistory.length === 0 ? (
          <p className="text-[13px] italic text-zinc-400">
            Nothing logged yet. Notes you leave when changing status land here —
            newest first.
          </p>
        ) : (
          <ol>
            {statusHistory.map((u) => {
              const s: RockStatus | null = isRockStatus(u.status)
                ? u.status
                : null;
              const when =
                u.created_at_ms != null
                  ? new Date(u.created_at_ms).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—";
              return (
                <li key={u.id} className="flex gap-3">
                  <div className="flex w-2.5 shrink-0 flex-col items-center">
                    <span
                      className={cn(
                        "mt-[5px] h-2.5 w-2.5 rounded-full",
                        s ? STATUS_BAR[s] : "bg-zinc-300 dark:bg-zinc-700",
                      )}
                      aria-hidden
                    />
                    <span className="w-0.5 flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {s && (
                        <span
                          className={cn(
                            "inline-flex h-[19px] items-center rounded-full px-2 text-[10px] font-semibold ring-1 ring-inset",
                            STATUS_STYLES[s],
                          )}
                        >
                          {STATUS_LABELS[s]}
                        </span>
                      )}
                      <span className="text-[11.5px] font-semibold text-zinc-700 dark:text-zinc-300">
                        {u.author_name}
                      </span>
                      <span className="text-[11.5px] text-zinc-400">{when}</span>
                    </div>
                    {u.comment ? (
                      <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-snug text-zinc-700 dark:text-zinc-300">
                        {u.comment}
                      </p>
                    ) : (
                      <p className="mt-1 text-[13px] italic text-zinc-400">
                        No comment
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <EntityComments
          teamId={teamId}
          entityType="rock"
          entityId={rock.id}
          userId={userId}
          members={members}
        />
      </div>
    </DetailModal>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-5 text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400">
      {children}
    </h3>
  );
}
