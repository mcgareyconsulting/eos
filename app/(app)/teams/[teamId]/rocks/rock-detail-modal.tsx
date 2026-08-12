"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RichText } from "@/components/rich-text";
import { DetailModal } from "@/components/detail-modal";
import { EntityComments } from "@/components/entity-comments";
import { formatDateOnly, relativeDueLabel } from "@/lib/dates";
import { dueToneClass } from "@/lib/due";
import { Fact } from "./fact";
import {
  ROCK_TYPE_LABELS,
  toFormRockType,
} from "./rock-type";
import {
  STATUS_BANNER,
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
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Full rock record: status banner, header, meta band, milestones with
 * progress, status history, and comments.
 */
export function RockDetailModal({
  teamId,
  userId,
  members,
  rock,
  ownerName,
  milestones,
  statusHistory = [],
  onClose,
}: {
  teamId: string;
  userId: string;
  members: Member[];
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
  statusHistory?: StatusUpdateSerialized[];
  onClose: () => void;
}) {
  const type = toFormRockType(rock.rock_type);
  const status: RockStatus | null = isRockStatus(rock.status)
    ? rock.status
    : null;
  const bar = status ? STATUS_BAR[status] : "bg-zinc-300 dark:bg-zinc-700";
  const banner = status ? STATUS_BANNER[status] : null;
  const doneCount = milestones.filter((m) => m.completed).length;
  const pct = milestones.length
    ? Math.round((doneCount / milestones.length) * 100)
    : 0;
  const hasDescription = !!rock.description?.trim();
  const isDone = rock.status === "done" || rock.status === "cancelled";

  const checklist: MilestoneSerialized[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    owner_id: null,
    owner_label: m.owner_name,
    due_date: m.due_date,
    completed: m.completed,
    description: null,
  }));

  const typeLabel = ROCK_TYPE_LABELS[type];
  const isIndividual = type === "individual";

  return (
    <DetailModal
      ariaLabel={`Rock: ${rock.title}`}
      onClose={onClose}
      size="lg"
      banner={
        banner ? (
          <div
            className={cn(
              "flex items-center justify-between border-b px-7 py-[9px]",
              banner.bg,
              banner.border,
            )}
          >
            <div className={cn("flex items-center gap-2", banner.text)}>
              {status === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
              ) : (
                <span
                  className={cn("h-2 w-2 rounded-full", bar)}
                  aria-hidden
                />
              )}
              <span className="text-xs font-extrabold">
                {status ? STATUS_LABELS[status] : "—"}
              </span>
            </div>
            <span
              className={cn(
                "text-[11.5px] font-bold opacity-65",
                banner.text,
              )}
            >
              {milestones.length === 0
                ? "No milestones"
                : `${doneCount} of ${milestones.length} milestones done`}
            </span>
          </div>
        ) : undefined
      }
    >
      <div className="pr-6">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-zinc-400">
          {rock.quarter || "—"}
        </div>
        <h2 className="mt-1 text-[21px] font-extrabold leading-[1.3] tracking-tight text-zinc-900 dark:text-zinc-50">
          {rock.title}
        </h2>
        <p className="mt-1.5 text-[12.5px] text-zinc-500">
          {isIndividual ? (
            <>
              Individual rock · owned by{" "}
              <span className="font-bold text-zinc-700 dark:text-zinc-300">
                {ownerName}
              </span>
            </>
          ) : (
            <>
              {typeLabel} · owned by{" "}
              <span className="font-bold text-zinc-700 dark:text-zinc-300">
                {ownerName}
              </span>
            </>
          )}
        </p>

        <dl className="mt-4 flex border-y border-zinc-100 dark:border-zinc-800">
          <Fact label="Owner">{ownerName}</Fact>
          <Fact label="Quarter">{rock.quarter || "—"}</Fact>
          <Fact label="Due" last>
            <span className="tabular-nums">
              {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
            </span>
            {rock.due_date ? (
              <>
                {" "}
                <span
                  className={cn(
                    "font-normal",
                    isDone
                      ? "text-zinc-400"
                      : dueToneClass(rock.due_date, false),
                  )}
                >
                  {relativeDueLabel(rock.due_date, new Date(), isDone)}
                </span>
              </>
            ) : null}
          </Fact>
        </dl>

        <SectionHeading>Description</SectionHeading>
        {hasDescription ? (
          <RichText
            value={rock.description}
            className="text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300"
          />
        ) : (
          <p className="text-[13px] italic text-zinc-400">Not defined yet.</p>
        )}

        <div className="mb-1.5 mt-5 flex items-center justify-between gap-3">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-zinc-400">
            Milestones
          </h3>
          {milestones.length > 0 && (
            <span className="text-xs font-extrabold tabular-nums text-zinc-600 dark:text-zinc-300">
              {doneCount}/{milestones.length}
            </span>
          )}
        </div>
        {milestones.length > 0 && (
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#ececee] dark:bg-zinc-700">
            <div
              className={cn("h-full rounded-full transition-[width]", bar)}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {milestones.length === 0 ? (
          <p className="text-[13px] italic text-zinc-400">No milestones yet.</p>
        ) : (
          <MilestoneChecklist
            teamId={teamId}
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
                    <span
                      className="w-0.5 flex-1 bg-zinc-200 dark:bg-zinc-800"
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1 pb-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {s && (
                        <span
                          className={cn(
                            "inline-flex h-[19px] items-center rounded-full px-2 text-[10px] font-extrabold ring-1 ring-inset",
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
    <h3 className="mb-1.5 mt-5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-zinc-400">
      {children}
    </h3>
  );
}
