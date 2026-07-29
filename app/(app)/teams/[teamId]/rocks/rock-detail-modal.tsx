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
  className,
  children,
}: {
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
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
  onClose,
}: {
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
  onClose: () => void;
}) {
  const type = normalizeRockType(rock.rock_type);
  const status = isRockStatus(rock.status) ? rock.status : null;
  const doneCount = milestones.filter((m) => m.completed).length;

  return (
    <DetailModal ariaLabel={`Rock: ${rock.title}`} onClose={onClose}>
      <div className="space-y-4 pr-6">
        <header>
          <h2 className="text-base font-semibold leading-snug">{rock.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                ROCK_TYPE_STYLES[type],
              )}
            >
              {ROCK_TYPE_LABELS[type]}
            </span>
            {status && (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  STATUS_STYLES[status],
                )}
              >
                {STATUS_LABELS[status]}
              </span>
            )}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Fact label="Owner">
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[9px] font-semibold text-hpb-blue ring-1 ring-inset ring-hpb-blue/30 dark:bg-hpb-gold/15 dark:text-hpb-gold dark:ring-hpb-gold/30">
                {initials(ownerName) || "?"}
              </span>
              {ownerName}
            </span>
          </Fact>
          <Fact label="Due">
            {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
          </Fact>
          <Fact label="Quarter">{rock.quarter || "—"}</Fact>
          <Fact label="Milestones">
            {milestones.length === 0
              ? "None"
              : `${doneCount}/${milestones.length} done`}
          </Fact>
        </dl>

        {rock.description && rock.description.trim().length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Description
            </h3>
            <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {rock.description}
            </p>
          </div>
        )}

        {milestones.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Milestones
            </h3>
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {milestones.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                      m.completed
                        ? "bg-hpb-green text-white ring-hpb-green"
                        : "bg-transparent ring-zinc-300 dark:ring-zinc-600",
                    )}
                  >
                    {m.completed && <Check className="h-3 w-3" />}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      m.completed && "text-zinc-500 line-through",
                    )}
                  >
                    {m.title}
                  </span>
                  {m.owner_name && (
                    <span className="shrink-0 text-xs text-zinc-500">
                      {m.owner_name}
                    </span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {m.due_date ? formatDateOnly(m.due_date) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
