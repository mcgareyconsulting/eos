"use client";

import { useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateOnly, relativeDueLabel } from "@/lib/dates";
import { StatusPopover } from "./status-popover";
import { RockDetailTrigger } from "./rock-detail-modal";
import { EditRockButton, RockModal } from "./rock-modal";
import { deleteRock } from "./actions";
import { dueToneClass } from "@/lib/due";
import { Fact } from "./fact";
import { isTeamRock, normalizeRockType, ROCK_TYPE_LABELS, ROCK_TYPE_STYLES } from "./rock-type";
import { STATUS_BAR, isRockStatus, type RockStatus } from "./status";
import {
  MilestoneChecklist,
  MilestoneProgress,
  type MilestoneSerialized,
} from "./milestone-checklist";
import { type StatusUpdateSerialized } from "./status-history";

type Rock = {
  id: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
};

type Member = { user_id: string; full_name: string };

/**
 * Collapsed row: status as a 3px rail + pill, owner · quarter · milestone
 * progress on one meta line, due date with a relative-days label.
 *
 * Expanded: a compact summary strip (owner / quarter / due / milestones), the
 * success criterion, the LATEST status note only, and a tickable milestone
 * checklist. The full status history and every editing affordance live in the
 * detail modal / RockModal — that split is what de-clutters the expand.
 */
export function RockRow({
  teamId,
  rock,
  ownerName,
  members,
  milestones,
  defaultDue,
  statusHistory = [],
  currentUserId,
  teamName,
}: {
  teamId: string;
  rock: Rock;
  ownerName: string;
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
  statusHistory?: StatusUpdateSerialized[];
  currentUserId: string;
  teamName?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const status: RockStatus = isRockStatus(rock.status) ? rock.status : "on_track";
  const type = normalizeRockType(rock.rock_type);
  const displayOwner = isTeamRock(rock.owner_id) ? "Team" : ownerName;
  const doneCount = milestones.filter((m) => m.completed).length;
  const hasDescription = !!rock.description?.trim();
  const latestNote = statusHistory.find((u) => u.comment?.trim());
  const remove = deleteRock.bind(null, teamId, rock.id);

  const detailMilestones = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    due_date: m.due_date,
    completed: m.completed,
    owner_name: m.owner_id
      ? (members.find((x) => x.user_id === m.owner_id)?.full_name ?? null)
      : null,
  }));

  return (
    <div className="group flex items-stretch">
      <div className={cn("w-[3px] shrink-0", STATUS_BAR[status])} aria-hidden />

      <div className="min-w-0 flex-1 py-2.5 pl-3 pr-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse rock" : "Expand rock"}
            className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <RockDetailTrigger
                teamId={teamId}
                rock={rock}
                ownerName={displayOwner}
                milestones={detailMilestones}
                statusHistory={statusHistory}
                className="max-w-full truncate text-left text-sm font-semibold hover:text-hpb-blue dark:hover:text-hpb-gold"
              >
                {rock.title}
              </RockDetailTrigger>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ring-1 ring-inset",
                  ROCK_TYPE_STYLES[type],
                )}
              >
                {ROCK_TYPE_LABELS[type]}
              </span>
            </div>

            <div className="mt-0.5 flex items-center gap-2.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              <span className="truncate">{displayOwner}</span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="tabular-nums">{rock.quarter || "—"}</span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              {milestones.length > 0 ? (
                <MilestoneProgress
                  milestones={milestones}
                  barClass={STATUS_BAR[status]}
                />
              ) : (
                <span className="italic text-zinc-400">no milestones</span>
              )}
            </div>
          </div>

          <div className="w-24 shrink-0 text-right">
            <div className="text-[12.5px] tabular-nums text-zinc-700 dark:text-zinc-300">
              {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
            </div>
            <div
              className={cn(
                "text-[10.5px] font-semibold",
                dueToneClass(rock.due_date, status === "done" || status === "cancelled"),
              )}
            >
              {relativeDueLabel(rock.due_date)}
            </div>
          </div>

          <div className="flex w-28 shrink-0 justify-end">
            <StatusPopover teamId={teamId} rockId={rock.id} status={rock.status} />
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <EditRockButton
              teamId={teamId}
              rock={rock}
              members={members}
              milestones={milestones}
              defaultDue={defaultDue}
              currentUserId={currentUserId}
              teamName={teamName}
            />
            <form action={remove}>
              <button
                type="submit"
                aria-label="Delete rock"
                className="rounded p-1 text-zinc-200 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-700"
              >
                <Trash2 className="h-[15px] w-[15px]" />
              </button>
            </form>
          </div>
        </div>

        {expanded && (
          <div className="mt-2.5 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/30">
            <dl className="flex flex-wrap border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <Fact label="Owner">{displayOwner}</Fact>
              <Fact label="Quarter">{rock.quarter || "—"}</Fact>
              <Fact label="Due">
                <span className="tabular-nums">
                  {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
                </span>{" "}
                <span
                  className={cn(
                    "font-normal",
                    dueToneClass(rock.due_date, status === "done"),
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

            <div className="space-y-2.5 px-3.5 py-3">
              {hasDescription && (
                <p className="text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Description:{" "}
                  </span>
                  {rock.description}
                </p>
              )}

              {latestNote?.comment && (
                <div className="rounded-r-md border-l-[3px] border-hpb-gold bg-hpb-gold/10 px-2.5 py-1.5">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-hpb-brown dark:text-hpb-gold">
                    Latest status note
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-300">
                    {latestNote.comment}
                  </p>
                </div>
              )}

              <MilestoneChecklist
                teamId={teamId}
                members={members}
                milestones={milestones}
              />

              <div className="flex items-center gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                <AddMilestoneLink
                  teamId={teamId}
                  rock={rock}
                  members={members}
                  milestones={milestones}
                  defaultDue={defaultDue}
                  currentUserId={currentUserId}
                  teamName={teamName}
                />
                <RockDetailTrigger
                  teamId={teamId}
                  rock={rock}
                  ownerName={displayOwner}
                  milestones={detailMilestones}
                  statusHistory={statusHistory}
                  className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Full detail &amp; status history →
                </RockDetailTrigger>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Text-link twin of EditRockButton — same modal, different affordance. */
function AddMilestoneLink(props: {
  teamId: string;
  rock: Rock;
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
  currentUserId: string;
  teamName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-hpb-blue hover:brightness-110 dark:text-hpb-gold"
      >
        <Plus className="h-3 w-3" strokeWidth={2.4} />
        Add milestone
      </button>
      {open && (
        <RockModal
          {...props}
          focusMilestones
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
