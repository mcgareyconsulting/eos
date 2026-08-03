"use client";

import { useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import { StatusPopover } from "./status-popover";
import { RockDetailTrigger } from "./rock-detail-modal";
import { EditRockDrawer } from "./edit-rock-drawer";
import { deleteRock } from "./actions";
import { isTeamRock } from "./rock-type";
import {
  MilestonesDisclosure,
  type MilestoneSerialized,
} from "./milestones";
import {
  LatestStatusComment,
  StatusHistoryList,
  type StatusUpdateSerialized,
} from "./status-history";

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

// View-first row: title → modal, description read-only on expand.
// Milestones stay actionable everywhere (check off / add) — rock title,
// owner, quarter, and description still edit via the pencil drawer.
export function RockRow({
  teamId,
  rock,
  ownerName,
  members,
  milestones,
  defaultDue,
  statusHistory = [],
}: {
  teamId: string;
  rock: Rock;
  ownerName: string;
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
  /** Append-only status comments (newest first). P0-5 discoverability. */
  statusHistory?: StatusUpdateSerialized[];
}) {
  const [expanded, setExpanded] = useState(false);
  const doneCount = milestones.filter((m) => m.completed).length;
  const hasDescription =
    !!rock.description && rock.description.trim().length > 0;
  const remove = deleteRock.bind(null, teamId, rock.id);
  const displayOwner = isTeamRock(rock.owner_id) ? "Team" : ownerName;

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
    <div className="group px-4 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse rock" : "Expand rock"}
          className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>

        <div className="min-w-0 flex-1">
          <RockDetailTrigger
            rock={rock}
            ownerName={displayOwner}
            milestones={detailMilestones}
            statusHistory={statusHistory}
            className="block max-w-full truncate text-left font-medium hover:text-hpb-blue dark:hover:text-hpb-gold"
          >
            {rock.title}
          </RockDetailTrigger>

          {!expanded && (rock.quarter || milestones.length > 0) && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {[
                rock.quarter || null,
                milestones.length > 0
                  ? `${doneCount}/${milestones.length} milestones`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {!expanded && <LatestStatusComment updates={statusHistory} />}
        </div>

        <div className="w-20 shrink-0 pt-0.5 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
          {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
        </div>
        <div className="flex w-28 shrink-0 justify-end">
          <StatusPopover
            teamId={teamId}
            rockId={rock.id}
            status={rock.status}
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <EditRockDrawer
            teamId={teamId}
            rock={rock}
            members={members}
            milestones={milestones}
            defaultDue={defaultDue}
          />
          <form action={remove}>
            <button
              type="submit"
              className="rounded p-1 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
              aria-label="Delete rock"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-7 space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Description
            </h4>
            {hasDescription ? (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {rock.description}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-400">
                No description — edit the rock to add one.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Status history
            </h4>
            <StatusHistoryList updates={statusHistory} />
          </div>

          <MilestonesDisclosure
            teamId={teamId}
            rockId={rock.id}
            rockOwnerId={rock.owner_id}
            members={members}
            milestones={milestones}
            defaultDue={defaultDue}
            alwaysOpen
          />
        </div>
      )}
    </div>
  );
}
