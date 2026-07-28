"use client";

import { useMemo } from "react";
import {
  collection,
  doc,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import { formatDateOnly } from "@/lib/dates";
import {
  currentSpeakerUid,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import { StatusPopover } from "../../rocks/status-popover";
import {
  MilestonesDisclosure,
  type MilestoneSerialized,
} from "../../rocks/milestones";
import { isTeamRock } from "../../rocks/rock-type";
import { QuickAddIssue } from "@/components/quick-add-issue";

type RockDoc = {
  id: string;
  team_id: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
};

// completed_at is a Firestore Timestamp from onSnapshot but a plain boolean
// when pre-rendered on the server (Timestamps can't cross the RSC boundary).
// We only ever read it as truthy/falsy here, so either works.
type TodoDoc = {
  id: string;
  team_id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | boolean | null;
  source_rock_id: string | null;
  description: string | null;
};

type Member = { user_id: string; full_name: string };

type RockGroup = {
  key: string;
  title: string;
  rocks: RockDoc[];
  absent: boolean;
  isCurrentSpeaker: boolean;
  /** Team-level section (Team Rocks) — not tied to the speaking rail. */
  isTeamSection: boolean;
};

const STATUS_ORDER = ["on_track", "off_track", "done", "cancelled"];

// Within a section: status, then due date.
function sortRocks(rocks: RockDoc[]): RockDoc[] {
  return [...rocks].sort((a, b) => {
    const byStatus =
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}

// L10 Rocks: optional Team Rocks section first (owner_id null), then person
// sections in speaking order. Absent owners stay visible but dimmed; current
// speaker is highlighted.
function groupRocksForMeeting(
  rocks: RockDoc[],
  members: Member[],
  speakingOrder: string[],
  absent: Set<string>,
  currentSpeaker: string | null,
): RockGroup[] {
  const teamRocks: RockDoc[] = [];
  const personal: RockDoc[] = [];
  for (const r of rocks) {
    if (isTeamRock(r.owner_id)) teamRocks.push(r);
    else personal.push(r);
  }

  const groups: RockGroup[] = [];
  if (teamRocks.length > 0) {
    groups.push({
      key: "team",
      title: "Team",
      rocks: sortRocks(teamRocks),
      absent: false,
      isCurrentSpeaker: false,
      isTeamSection: true,
    });
  }

  const byOwner = new Map<string, RockDoc[]>();
  for (const r of personal) {
    const id = r.owner_id as string;
    const list = byOwner.get(id) ?? [];
    list.push(r);
    byOwner.set(id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const placed = new Set<string>();

  for (const uid of speakingOrder) {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) continue;
    placed.add(uid);
    groups.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      rocks: sortRocks(list),
      absent: absent.has(uid),
      isCurrentSpeaker: uid === currentSpeaker,
      isTeamSection: false,
    });
  }

  // Owners with rocks who aren't in the reconciled order (stale owner_id).
  const orphans = [...byOwner.keys()].filter((id) => !placed.has(id));
  orphans.sort((a, b) =>
    (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—"),
  );
  for (const uid of orphans) {
    const list = byOwner.get(uid)!;
    groups.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      rocks: sortRocks(list),
      absent: absent.has(uid),
      isCurrentSpeaker: uid === currentSpeaker,
      isTeamSection: false,
    });
  }

  return groups;
}

export function SegmentRocks({
  teamId,
  meetingId,
  defaultDue,
  initialRocks,
  initialTodos,
  members,
  initialAbsentUserIds,
  initialSpeakingOrder,
  initialSpeakerIndex,
}: {
  teamId: string;
  meetingId: string;
  defaultDue: string;
  initialRocks: RockDoc[];
  initialTodos: TodoDoc[];
  members: Member[];
  initialAbsentUserIds: string[];
  initialSpeakingOrder: string[];
  initialSpeakerIndex: number;
}) {
  const db = getClientDb();

  const rocksQuery = useMemo(
    () => fsQuery(collection(db, "rocks"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  // Milestones are todos with source_rock_id set and visibility="team".
  // We must filter by visibility to satisfy the per-doc rule (otherwise
  // Firestore rejects the whole subscription if any private todo matches).
  const todosQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "todos"),
        where("team_id", "==", teamId),
        where("visibility", "==", "team"),
      ),
    [db, teamId],
  );

  const rocks = useCollection<RockDoc>(rocksQuery, initialRocks);
  const todos = useCollection<TodoDoc>(todosQuery, initialTodos);

  // Attendance + speaking rotation live on the meeting doc. Subscribe so
  // marking someone absent / advancing the floor reorders/dims sections live.
  const meetingRef = useMemo(
    () => doc(db, "meetings", meetingId),
    [db, meetingId],
  );
  const meeting = useDoc<{
    absent_user_ids?: string[];
    speaking_order?: string[];
    speaking_index?: number;
  }>(
    meetingRef,
    {
      absent_user_ids: initialAbsentUserIds,
      speaking_order: initialSpeakingOrder,
      speaking_index: initialSpeakerIndex,
    },
    "segment-rocks",
  );
  const absent = new Set(meeting.absent_user_ids ?? []);
  const speakingOrder = reconcileSpeakingOrder(meeting.speaking_order, members);
  const speakerIndex = meeting.speaking_index ?? 0;
  const currentSpeaker = currentSpeakerUid(
    speakingOrder,
    speakerIndex,
    meeting.absent_user_ids ?? [],
  );

  const milestonesByRock = new Map<string, MilestoneSerialized[]>();
  for (const t of todos) {
    if (!t.source_rock_id) continue;
    const list = milestonesByRock.get(t.source_rock_id) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      owner_id: t.owner_id,
      due_date: t.due_date,
      completed: !!t.completed_at,
      description: t.description ?? null,
    });
    milestonesByRock.set(t.source_rock_id, list);
  }
  for (const list of milestonesByRock.values()) {
    list.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  }

  // Show every non-cancelled rock. This used to filter on
  // r.quarter === currentQuarter(), but `quarter` is a free-text label —
  // imported rocks carry the client's own fiscal wording ("Q2 FY 2026"),
  // which never string-matches "2026-Q3", so the segment rendered empty
  // while the Rocks tab (which doesn't filter) looked fine. The meeting
  // reviews the rocks the team actually has; cancelled ones stay out.
  const visible = rocks.filter((r) => r.status !== "cancelled");
  const groups = groupRocksForMeeting(
    visible,
    members,
    speakingOrder,
    absent,
    currentSpeaker,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {visible.length} rock{visible.length === 1 ? "" : "s"} ·
          Team, then speaker order · off-track? drop to Issues
        </div>
        <QuickAddIssue teamId={teamId} prefill="Off-track rock: " compact />
      </div>

      {groups.length === 0 && (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
          No rocks yet — add them on the Rocks tab.
        </div>
      )}

      {groups.map((g) => (
        <section
          key={g.key}
          className={
            g.isCurrentSpeaker
              ? "rounded-xl ring-2 ring-hpb-green/40"
              : undefined
          }
        >
          <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
            <h3
              className={
                "text-sm font-semibold tracking-tight " +
                (g.isCurrentSpeaker
                  ? "text-hpb-green"
                  : "text-zinc-800 dark:text-zinc-200") +
                (g.absent ? " opacity-70" : "")
              }
            >
              {g.title}
              <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-500">
                ({g.rocks.length})
              </span>
              {g.isCurrentSpeaker && (
                <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-hpb-green">
                  Now speaking
                </span>
              )}
              {g.absent && !g.isCurrentSpeaker && (
                <span className="ml-2 text-[11px] font-normal text-zinc-500">
                  Absent
                </span>
              )}
            </h3>
          </div>
          <div
            className={
              "rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 " +
              (g.absent ? "opacity-70" : "")
            }
          >
            {g.rocks.map((r) => (
              <div
                key={r.id}
                className="group grid grid-cols-12 gap-3 px-4 py-3 items-start text-sm"
              >
                <div className="col-span-9 min-w-0">
                  <div className="font-medium">{r.title}</div>
                  {r.description && (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-1">
                      {r.description}
                    </div>
                  )}
                </div>
                <div className="col-span-1 text-zinc-600 dark:text-zinc-400 text-xs">
                  {r.due_date ? formatDateOnly(r.due_date) : "—"}
                </div>
                <div className="col-span-2 justify-self-end">
                  <StatusPopover
                    teamId={teamId}
                    rockId={r.id}
                    status={r.status}
                  />
                </div>
                <MilestonesDisclosure
                  teamId={teamId}
                  rockId={r.id}
                  rockOwnerId={r.owner_id}
                  rockDescription={r.description}
                  members={members}
                  milestones={milestonesByRock.get(r.id) ?? []}
                  defaultDue={defaultDue}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
