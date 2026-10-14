"use client";

import { useState } from "react";
import { Archive, ChevronRight, Plus, Trash2 } from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { cn } from "@/lib/utils";
import { RichText } from "@/components/rich-text";
import { hasRichMarkup } from "@/lib/rich-text";
import { formatDateOnly, formatDateShort, relativeDueLabel } from "@/lib/dates";
import type { RockHeadline } from "@/lib/access/rock";
import { StatusPill, StatusPopover } from "./status-popover";
import { RockDetailTrigger } from "./rock-detail-modal";
import { EditRockButton, RockModal } from "./rock-modal";
import { deleteRock, setRockArchived } from "./actions";
import { dueToneClass } from "@/lib/due";
import { Fact } from "./fact";
import {
  isCompanyRock,
  isTeamRock,
  ROCK_TYPE_LABELS,
  ROCK_TYPE_STYLES,
  type RockType,
} from "./rock-type";
import { STATUS_BAR, isRockStatus, type RockStatus } from "./status";
import {
  MilestoneChecklist,
  MilestoneProgress,
  type MilestoneSerialized,
} from "./milestone-checklist";
import { TodoCheckbox } from "../todos/todo-row";
import { type StatusUpdateSerialized } from "./status-history";

type Rock = {
  id: string;
  team_id?: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
  is_company_rock?: boolean | null;
  audience_team_ids?: string[] | null;
  audience_user_ids?: string[] | null;
  private?: boolean | null;
  archived_at?: unknown | null;
  assigned_by?: string | null;
  created_by?: string | null;
  follower_ids?: string[] | null;
};

type Member = { user_id: string; full_name: string };
type ShareTeam = { id: string; name: string };

/**
 * A full rock (spec §3.3): the parent team's own, or one with this team in
 * its audience. Collapsed row: status rail + pill, owner · quarter ·
 * milestone progress, due date with relative label. Expanded panel
 * indented under the title.
 */
export function RockRow({
  teamId,
  viewTeamId,
  userId,
  rock,
  ownerName,
  members,
  milestones,
  defaultDue,
  statusHistory = [],
  currentUserId,
  teamName,
  shareTeams = [],
  canFlagCompany = false,
  canEdit = true,
  canDelete = canEdit,
  canManageAudience = false,
  fromTeamName,
}: {
  /** The rock's PARENT team — every rock action runs against it. */
  teamId: string;
  /** The page's team, which the viewer is on: ticks and the thread run
   *  from here (an audience member may not be on the parent team). */
  viewTeamId?: string;
  userId: string;
  rock: Rock;
  ownerName: string;
  /** The parent team's roster (the rock owner must be on it). */
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
  statusHistory?: StatusUpdateSerialized[];
  currentUserId: string;
  teamName?: string;
  shareTeams?: ShareTeam[];
  /** Org admin — may set the Company flag in the edit modal. */
  canFlagCompany?: boolean;
  /** Edit, status, milestones (rockAccess.canEdit): parent team + audience. */
  canEdit?: boolean;
  /** Archive and delete (rockAccess.canDelete): parent team only. */
  canDelete?: boolean;
  /** Audience and Private (rockAccess.canChangeAudience): leaders + admins. */
  canManageAudience?: boolean;
  /**
   * Parent team name when the rock is rendering on a team in its audience.
   * Shown as a chip — the rock lives elsewhere.
   */
  fromTeamName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const actTeamId = viewTeamId ?? teamId;

  const status: RockStatus = isRockStatus(rock.status) ? rock.status : "on_track";
  // Kind pills are a set, not one-of: a rock can be Company and Team at once
  // (lib/rock-bucket.ts). Individual is the absence of both and carries no
  // pill — the owner's name already says it (Daniel, 2026-10-14).
  const pills: RockType[] = [];
  if (isCompanyRock(rock)) pills.push("company");
  if (isTeamRock(rock)) pills.push("department");
  // Always prefer person name; a null owner (deactivated person) reads Unassigned.
  const displayOwner = ownerName || "Unassigned";
  const doneCount = milestones.filter((m) => m.completed).length;
  const hasDescription = !!rock.description?.trim();
  const latestNote = statusHistory.find((u) => u.comment?.trim());
  const remove = deleteRock.bind(null, teamId, rock.id);
  const archivedRow = rock.archived_at != null;
  const toggleArchive = setRockArchived.bind(null, teamId, rock.id, !archivedRow);

  const detailMilestones = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    due_date: m.due_date,
    completed: m.completed,
    description: m.description,
    owner_name: m.owner_id
      ? (m.owner_label ??
        members.find((x) => x.user_id === m.owner_id)?.full_name ??
        null)
      : null,
  }));

  const modalProps = {
    teamId,
    rock,
    members,
    milestones,
    defaultDue,
    currentUserId,
    teamName,
    shareTeams,
    canFlagCompany,
    canManageAudience,
  };

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
                deepLink
                teamId={actTeamId}
                userId={userId}
                members={members}
                rock={rock}
                ownerName={displayOwner}
                milestones={detailMilestones}
                statusHistory={statusHistory}
                readOnly={!canEdit}
                sourceTeamName={fromTeamName}
                className="max-w-full truncate text-left text-sm font-semibold hover:text-hpb-blue dark:hover:text-hpb-gold"
              >
                {rock.title}
              </RockDetailTrigger>
              {pills.map((p) => (
                <span
                  key={p}
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ring-1 ring-inset",
                    ROCK_TYPE_STYLES[p],
                  )}
                >
                  {ROCK_TYPE_LABELS[p]}
                </span>
              ))}
              {fromTeamName ? <FromTeamChip name={fromTeamName} /> : null}
            </div>

            <div className="mt-0.5 flex items-center gap-2.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              <span className="truncate">{displayOwner}</span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="tabular-nums">{rock.quarter || "—"}</span>
              {milestones.length > 0 ? (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <MilestoneProgress
                    milestones={milestones}
                    barClass={STATUS_BAR[status]}
                  />
                </>
              ) : null}
            </div>
          </div>

          <div className="w-24 shrink-0 text-right">
            <div className="text-[12.5px] tabular-nums text-zinc-700 dark:text-zinc-300">
              {rock.due_date ? formatDateOnly(rock.due_date) : "—"}
            </div>
            <div
              className={cn(
                "text-[10.5px] font-semibold",
                dueToneClass(
                  rock.due_date,
                  status === "done" || status === "cancelled",
                ),
              )}
            >
              {relativeDueLabel(
                rock.due_date,
                new Date(),
                status === "done" || status === "cancelled",
              )}
            </div>
          </div>

          <div className="flex w-28 shrink-0 justify-end">
            {canEdit ? (
              <StatusPopover teamId={teamId} rockId={rock.id} status={rock.status} />
            ) : (
              <StatusPill status={rock.status} />
            )}
          </div>

          {/* Fixed width so a read-only row (no edit / archive / delete) keeps
              the same horizontal lineup as the editable rows around it —
              otherwise the status pill slides right into this space. Three
              23px icon buttons (a 15px icon + p-1) with gap-0.5 between. */}
          <div className="flex w-[73px] shrink-0 items-center justify-end gap-0.5">
            {canEdit && (
              <EditRockButton
                {...modalProps}
                className="text-zinc-300 opacity-0 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-200"
              />
            )}
            {canDelete && (
              <>
                <form action={toggleArchive}>
                  <button
                    type="submit"
                    aria-label={archivedRow ? "Restore rock" : "Archive rock"}
                    title={archivedRow ? "Restore" : "Archive now"}
                    className="rounded p-1 text-zinc-300 opacity-0 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    <Archive className="h-[15px] w-[15px]" />
                  </button>
                </form>
                {!archivedRow && (
                  <ConfirmSubmitForm
                    action={remove}
                    confirmMessage="Delete this rock? This will also delete its milestones and comments. This can't be undone."
                  >
                    <button
                      type="submit"
                      aria-label="Delete rock"
                      className="rounded p-1 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
                    >
                      <Trash2 className="h-[15px] w-[15px]" />
                    </button>
                  </ConfirmSubmitForm>
                )}
              </>
            )}
          </div>
        </div>

        {expanded && (
          <div className="ml-[25px] mt-2.5 overflow-hidden rounded-[10px] border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/30">
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
                  {relativeDueLabel(
                    rock.due_date,
                    new Date(),
                    status === "done",
                  )}
                </span>
              </Fact>
              <Fact label="Milestones" last>
                {milestones.length === 0
                  ? "None"
                  : `${doneCount} of ${milestones.length} done`}
              </Fact>
            </dl>

            <div className="space-y-2.5 px-3.5 py-3">
              {hasDescription &&
                (hasRichMarkup(rock.description) ? (
                  <div className="text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">
                      Description
                    </span>
                    <RichText value={rock.description} className="mt-0.5" />
                  </div>
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">
                      Description:{" "}
                    </span>
                    {rock.description}
                  </p>
                ))}

              {latestNote?.comment && (
                <div className="rounded-r-lg border-l-[3px] border-status-amber bg-[rgba(240,180,41,.10)] px-3 py-2 dark:bg-[rgba(240,180,41,.16)]">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#8a5a10] dark:text-status-amber">
                    Latest status note
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-300">
                    {latestNote.comment}
                  </p>
                </div>
              )}

              <MilestoneChecklist
                teamId={actTeamId}
                members={members}
                milestones={milestones}
                readOnly={!canEdit}
                currentUserId={currentUserId}
                userId={userId}
              />

              <div className="flex items-center gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                {canEdit && <AddMilestoneLink {...modalProps} />}
                <RockDetailTrigger
                  teamId={actTeamId}
                  userId={userId}
                  members={members}
                  rock={rock}
                  ownerName={displayOwner}
                  milestones={detailMilestones}
                  statusHistory={statusHistory}
                  readOnly={!canEdit}
                  sourceTeamName={fromTeamName}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Full detail &amp; activity →
                </RockDetailTrigger>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FromTeamChip({ name }: { name: string }) {
  return (
    <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] font-semibold text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
      from {name}
    </span>
  );
}

/**
 * One entry in a member's block (spec §4): a milestone they own on another
 * team's rock. Shows ONLY the rock's headline (title, owner, team) and the
 * milestone(s) — no status, due date, description or thread, and no way in
 * to the rock. Read-only; the milestone's own assignee may tick it.
 *
 * Same shell as RockRow (rail, chevron, title line, owner line, fixed-width
 * columns) so a block sits in a section without looking like a different
 * kind of thing; what differs is behaviour, not style. The rail is neutral
 * and the due/status/actions slots stay empty because the headline carries
 * none of that. Collapsed by default, like every other row.
 */
export function RockBlockRow({
  viewTeamId,
  headline,
  ownerName,
  fromTeamName,
  milestones,
  currentUserId,
}: {
  /** The page's team — the assignee's tick runs from here. */
  viewTeamId: string;
  headline: RockHeadline;
  ownerName: string;
  fromTeamName: string;
  milestones: MilestoneSerialized[];
  currentUserId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayOwner = ownerName || "Unassigned";

  return (
    <div className="group flex items-stretch">
      <div className="w-[3px] shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />

      <div className="min-w-0 flex-1 py-2.5 pl-3 pr-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse milestones" : "Expand milestones"}
            className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">
                {headline.title}
              </span>
              <FromTeamChip name={fromTeamName} />
            </div>

            <div className="mt-0.5 flex items-center gap-2.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              <span className="truncate">{displayOwner}</span>
              {milestones.length > 0 ? (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <MilestoneProgress
                    milestones={milestones}
                    barClass="bg-zinc-400 dark:bg-zinc-500"
                  />
                </>
              ) : null}
            </div>
          </div>

          {/* Empty twins of RockRow's due, status and action slots: the
              headline has none of these, but the title and owner columns
              must line up with the full rocks around it. */}
          <div className="w-24 shrink-0" aria-hidden />
          <div className="w-28 shrink-0" aria-hidden />
          <div className="w-[73px] shrink-0" aria-hidden />
        </div>

        {expanded && (
          <div className="ml-[25px] mt-2.5 overflow-hidden rounded-[10px] border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/30">
            <ul className="px-1.5 py-1.5">
              {milestones.map((m) => {
                const mine = m.owner_id === currentUserId;
                return (
                  <li key={m.id}>
                    <label
                      className={cn(
                        "flex items-center gap-2.5 rounded-[7px] px-2 py-1",
                        mine && "cursor-pointer hover:bg-zinc-200/50 dark:hover:bg-zinc-800",
                      )}
                    >
                      {mine ? (
                        <TodoCheckbox
                          teamId={viewTeamId}
                          todoId={m.id}
                          completed={m.completed}
                          appearance="milestone"
                        />
                      ) : (
                        <span
                          className={cn(
                            "inline-block h-4 w-4 shrink-0 rounded-sm border",
                            m.completed
                              ? "border-hpb-green bg-hpb-green"
                              : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900",
                          )}
                          aria-hidden
                        />
                      )}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[13px]",
                          m.completed
                            ? "text-zinc-400 dark:text-zinc-500"
                            : "font-medium text-zinc-800 dark:text-zinc-200",
                        )}
                      >
                        {m.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-zinc-400">
                        {m.owner_label ?? (m.owner_id ? "—" : "Unassigned")}
                      </span>
                      <span
                        className={cn(
                          "w-14 shrink-0 text-right text-[11.5px] tabular-nums",
                          dueToneClass(m.due_date, m.completed),
                        )}
                      >
                        {formatDateShort(m.due_date)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
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
  shareTeams?: ShareTeam[];
  canFlagCompany?: boolean;
  canManageAudience?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-extrabold text-hpb-blue hover:brightness-110 dark:text-hpb-gold"
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
