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
import { StatusPopover } from "../../rocks/status-popover";
import { RockTypeBadge } from "../../rocks/rock-type-badge";
import {
  MilestonesDisclosure,
  type MilestoneSerialized,
} from "../../rocks/milestones";
import { ROCK_TYPE_ORDER, normalizeRockType } from "../../rocks/rock-type";
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

const STATUS_ORDER = ["on_track", "off_track", "done", "cancelled"];

// Company rocks first, then department, then individual — mirrors
// app/(app)/teams/[teamId]/rocks/page.tsx's sortRocks so the meeting segment
// and the standalone Rocks tab order rocks identically.
function sortRocks(rocks: RockDoc[]): RockDoc[] {
  return [...rocks].sort((a, b) => {
    const byType =
      ROCK_TYPE_ORDER.indexOf(normalizeRockType(a.rock_type)) -
      ROCK_TYPE_ORDER.indexOf(normalizeRockType(b.rock_type));
    if (byType !== 0) return byType;
    const byStatus =
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}

export function SegmentRocks({
  teamId,
  meetingId,
  quarter,
  defaultDue,
  initialRocks,
  initialTodos,
  members,
  initialAbsentUserIds,
}: {
  teamId: string;
  meetingId: string;
  quarter: string;
  defaultDue: string;
  initialRocks: RockDoc[];
  initialTodos: TodoDoc[];
  members: Member[];
  initialAbsentUserIds: string[];
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

  // Attendance is set on the Segue stage and lives on the meeting doc, so
  // subscribe rather than relying on the server-rendered value — marking
  // someone absent should dim their rocks for everyone immediately.
  const meetingRef = useMemo(
    () => doc(db, "meetings", meetingId),
    [db, meetingId],
  );
  const meeting = useDoc<{ absent_user_ids?: string[] }>(
    meetingRef,
    { absent_user_ids: initialAbsentUserIds },
    "segment-rocks",
  );
  const absent = new Set(meeting.absent_user_ids ?? []);

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

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  const visible = sortRocks(rocks.filter((r) => r.quarter === quarter));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {visible.length} rock{visible.length === 1 ? "" : "s"} · {quarter} ·
          off-track? drop to IDS
        </div>
        <QuickAddIssue teamId={teamId} prefill="Off-track rock: " compact />
      </div>

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No rocks for {quarter}.
          </div>
        )}
        {visible.map((r) => {
          // Owner isn't in the room. Dim the row so the group can see at a
          // glance what's actually reportable this week — but keep it fully
          // readable and interactive. This is a cue, not a lock.
          const ownerAbsent = !!r.owner_id && absent.has(r.owner_id);
          return (
          <div
            key={r.id}
            className={
              "group grid grid-cols-12 gap-3 px-4 py-3 items-start text-sm " +
              (ownerAbsent ? "bg-zinc-50 opacity-70 dark:bg-zinc-900/50" : "")
            }
          >
            <div className="col-span-6 min-w-0">
              <div className="font-medium">{r.title}</div>
              {r.description && (
                <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-1">
                  {r.description}
                </div>
              )}
              <div className="mt-0.5">
                <RockTypeBadge
                  teamId={teamId}
                  rockId={r.id}
                  rockType={r.rock_type}
                />
              </div>
            </div>
            <div className="col-span-3 text-zinc-600 dark:text-zinc-400">
              {ownerName(r.owner_id)}
              {ownerAbsent && (
                <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Absent
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
          );
        })}
      </div>
    </div>
  );
}
