"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailModal } from "@/components/detail-modal";
import { formatDateOnly } from "@/lib/dates";
import { initials } from "@/lib/initials";
import {
  ROCK_TYPE_LABELS,
  ROCK_TYPE_STYLES,
  normalizeRockType,
} from "./rock-type";
import { STATUS_LABELS, STATUS_STYLES, isRockStatus } from "./status";
import {
  StatusHistoryList,
  type StatusUpdateSerialized,
} from "./status-history";

// Plain-data shapes only: the trigger is rendered from both Server Components
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

export function RockDetailTrigger({
  rock,
  ownerName,
  milestones,
  statusHistory = [],
  className,
  children,
}: {
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

export function RockDetailModal({
  rock,
  ownerName,
  milestones,
  statusHistory = [],
  onClose,
}: {
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
  statusHistory?: StatusUpdateSerialized[];
  onClose: () => void;
}) {
  const type = normalizeRockType(rock.rock_type);
  const status = isRockStatus(rock.status) ? rock.status : null;
  const doneCount = milestones.filter((m) => m.completed).length;
  const hasDescription =
    !!rock.description && rock.description.trim().length > 0;

  return (
    <DetailModal ariaLabel={`Rock: ${rock.title}`} onClose={onClose} size="lg">
      <div className="space-y-6 pr-6">
        <header className="space-y-3">
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {rock.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                ROCK_TYPE_STYLES[type],
              )}
            >
              {ROCK_TYPE_LABELS[type]}
            </span>
            {status && (
              <span
                className={cn(
                  "inline-flex h-5 w-[5.5rem] items-center justify-center rounded-full px-2.5 text-[11px] font-medium ring-1 ring-inset",
                  STATUS_STYLES[status],
                )}
              >
                {STATUS_LABELS[status]}
              </span>
            )}
          </div>
        </header>

        <section
          aria-label="Rock details"
          className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="Owner">
              <span className="inline-flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue ring-1 ring-inset ring-hpb-blue/30 dark:bg-hpb-gold/15 dark:text-hpb-gold dark:ring-hpb-gold/30">
                  {initials(ownerName) || "?"}
                </span>
                <span className="font-medium">{ownerName}</span>
              </span>
            </Fact>
            <Fact label="Due">
              <span className="tabular-nums">
                {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
              </span>
            </Fact>
            <Fact label="Quarter">
              <span>{rock.quarter || "—"}</span>
            </Fact>
            <Fact label="Milestones">
              {milestones.length === 0
                ? "None"
                : `${doneCount} of ${milestones.length} done`}
            </Fact>
          </dl>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Description
          </h3>
          {hasDescription ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {rock.description}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No description.</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Status history
          </h3>
          <StatusHistoryList updates={statusHistory} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Milestones
            {milestones.length > 0 && (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-400">
                ({doneCount}/{milestones.length})
              </span>
            )}
          </h3>
          {milestones.length === 0 ? (
            <p className="text-sm text-zinc-500">No milestones.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {milestones.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-3 bg-white px-4 py-3 text-sm dark:bg-zinc-900"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                      m.completed
                        ? "bg-hpb-green text-white ring-hpb-green"
                        : "bg-transparent ring-zinc-300 dark:ring-zinc-600",
                    )}
                  >
                    {m.completed && <Check className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div
                      className={cn(
                        "leading-snug",
                        m.completed && "text-zinc-500 line-through",
                      )}
                    >
                      {m.title}
                    </div>
                    {m.owner_name && (
                      <div className="text-xs text-zinc-500">{m.owner_name}</div>
                    )}
                  </div>
                  <span className="shrink-0 pt-0.5 text-xs tabular-nums text-zinc-500">
                    {m.due_date ? formatDateOnly(m.due_date) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DetailModal>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}
