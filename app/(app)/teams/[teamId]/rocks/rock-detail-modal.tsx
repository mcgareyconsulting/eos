"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RichText } from "@/components/rich-text";
import { ActivityFeed } from "@/components/activity-feed";
import { DetailShell } from "@/components/detail-shell";
import { DiscardChangesDialog, useDiscardGuard } from "@/components/ui/modal";
import { eventsFromStatusHistory } from "@/lib/activity-feed";
import { formatDateOnly, relativeDueLabel } from "@/lib/dates";
import {
  effectiveFollowers,
  isFollowing,
  isLockedFollower,
} from "@/lib/follow";
import { RockFollowButton } from "./rock-follow-button";
import { dueToneClass } from "@/lib/due";
import { Fact } from "./fact";
import {
  STATUS_BANNER,
  STATUS_BAR,
  STATUS_LABELS,
  isRockStatus,
  rockStatusDotClass,
  rockStatusLabel,
  type RockStatus,
} from "./status";
import {
  MilestoneChecklist,
  type MilestoneSerialized,
} from "./milestone-checklist";
import { useMilestoneDrafts } from "./milestone-expansion";
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
  is_company_rock?: boolean | null;
  // Follow state (lib/follow.ts reads these); absent on a legacy doc.
  owner_id?: string | null;
  assigned_by?: string | null;
  created_by?: string | null;
  follower_ids?: string[] | null;
};

export type RockDetailMilestone = {
  id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
  owner_name: string | null;
  /** Rich text; shown when the milestone is expanded. */
  description?: string | null;
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
  readOnly = false,
  sourceTeamName,
  deepLink = false,
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
  readOnly?: boolean;
  /** Parent team of a shared-in rock — shown as "shared from {team}". */
  sourceTeamName?: string;
  /**
   * Open on arrival when the URL says `?rock=<this id>` or
   * `?milestone=<one of its milestones>` (the links notifications carry).
   * Set on the one trigger per rock the page renders, not on every surface.
   */
  deepLink?: boolean;
}) {
  const sp = useSearchParams();
  const linked =
    sp.get("rock") === rock.id ||
    milestones.some((m) => m.id === sp.get("milestone"));
  const [open, setOpen] = useState(deepLink && linked);
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
          readOnly={readOnly}
          sourceTeamName={sourceTeamName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Full rock record on the wide two-column shell (R3): status banner across
 * the top; header, meta band, description and milestones on the left; the
 * rock's ActivityFeed on the right — comments, status changes with their
 * notes (what the Status history section used to show) and milestone ticks
 * in one newest-first timeline.
 */
function RockDetailModal({
  teamId,
  userId,
  members,
  rock,
  ownerName,
  milestones,
  statusHistory = [],
  onClose,
  readOnly = false,
  sourceTeamName,
}: {
  teamId: string;
  userId: string;
  members: Member[];
  rock: RockDetailData;
  ownerName: string;
  milestones: RockDetailMilestone[];
  statusHistory?: StatusUpdateSerialized[];
  onClose: () => void;
  /** Guest-team view of a shared-in rock — read-only milestones. */
  readOnly?: boolean;
  /** Parent team of a shared-in rock — shown as "shared from {team}". */
  sourceTeamName?: string;
}) {
  const status: RockStatus | null = isRockStatus(rock.status)
    ? rock.status
    : null;
  const bar = status ? STATUS_BAR[status] : "bg-zinc-300 dark:bg-zinc-700";
  const banner = status ? STATUS_BANNER[status] : null;
  const doneCount = milestones.filter((m) => m.completed).length;
  const pct = milestones.length
    ? Math.round((doneCount / milestones.length) * 100)
    : 0;
  const followDoc = {
    owner_id: rock.owner_id ?? null,
    assigned_by: rock.assigned_by ?? null,
    created_by: rock.created_by ?? null,
    follower_ids: rock.follower_ids ?? [],
  };
  const hasDescription = !!rock.description?.trim();
  const isDone = rock.status === "done" || rock.status === "cancelled";

  const checklist: MilestoneSerialized[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    owner_id: null,
    owner_label: m.owner_name,
    due_date: m.due_date,
    completed: m.completed,
    description: m.description ?? null,
  }));

  // Status history folds into the feed as status-change events, each note
  // as its detail. Milestone ticks join live from the milestones' own traces
  // (ActivityFeed subscribes to them).
  // TODO(activity-rules): owner and due-date changes join here once rocks
  // record an activity trace — today only to-dos write one, and the
  // entity_activity read rule serves to-do rows only.
  const statusEvents = useMemo(
    () => eventsFromStatusHistory(statusHistory, rockStatusLabel),
    [statusHistory],
  );

  // An unsent comment in the feed — the rock's, or an expanded milestone's
  // — puts "Discard?" in front of every way out — backdrop, Escape, the × —
  // like the app's other forms.
  const [hasDraft, setHasDraft] = useState(false);
  const milestoneDrafts = useMilestoneDrafts();
  const guard = useDiscardGuard(
    hasDraft || milestoneDrafts.hasDraft,
    onClose,
  );

  return (
    <>
      <DetailShell
        ariaLabel={`Rock: ${rock.title}`}
        onClose={guard.requestClose}
        dismissible={!guard.asking}
        aside={
          <ActivityFeed
            teamId={teamId}
            entityType="rock"
            entityId={rock.id}
            userId={userId}
            members={members}
            events={statusEvents}
            milestones={milestones}
            statusDotClass={rockStatusDotClass}
            onDraftChange={setHasDraft}
          />
        }
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
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-zinc-400">
            {rock.quarter || "—"}
          </div>
          <h2 className="mt-1 text-[21px] font-extrabold leading-[1.3] tracking-tight text-zinc-900 dark:text-zinc-50">
            {rock.title}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-zinc-500">
            Owner:{" "}
            <span className="font-bold text-zinc-700 dark:text-zinc-300">
              {ownerName}
            </span>
            {/* Team names only when the rock lives on another team — on your own
                team it is the page you are already looking at. */}
            {sourceTeamName ? (
              <>
                {" · Team: "}
                <span className="font-bold text-zinc-700 dark:text-zinc-300">
                  {sourceTeamName}
                </span>
              </>
            ) : null}
          </p>

          <div className="mt-3">
            <RockFollowButton
              teamId={teamId}
              rockId={rock.id}
              following={isFollowing("rock", followDoc, userId)}
              followerCount={effectiveFollowers("rock", followDoc).length}
              locked={isLockedFollower("rock", followDoc, userId)}
            />
          </div>

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
            // A name opens the milestone in place: description + its own
            // feed. Anyone who sees this rock may comment on its milestones
            // (milestoneAccess.canComment ⊇ seesFullRock), read-only or not.
            <MilestoneChecklist
              teamId={teamId}
              members={members}
              milestones={checklist}
              variant="modal"
              readOnly={readOnly}
              userId={userId}
              onDraft={milestoneDrafts.report}
            />
          )}
        </div>
      </DetailShell>
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-zinc-400">
      {children}
    </h3>
  );
}
