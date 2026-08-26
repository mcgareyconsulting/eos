"use client";

import { useMemo, useState } from "react";
import { collection, doc, query as fsQuery, where } from "firebase/firestore";
import { Users } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import { initials } from "@/lib/initials";
import {
  currentSpeakerUid,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import { groupRocksForL10 } from "@/lib/l10/rock-order";
import {
  groupSharedRocksByOwner,
  isSharedIntoTeam,
} from "@/lib/rocks-share";
import {
  DEPARTMENT_SECTION_TITLE,
  isDepartmentRock,
} from "../../rocks/rock-type";
import { RockRow } from "../../rocks/rock-row";
import { type MilestoneSerialized } from "../../rocks/milestone-checklist";
import { type StatusUpdateSerialized } from "../../rocks/status-history";
import { EntityViewToggle } from "@/components/entity-view-tabs";
import { QuickAddIssue } from "@/components/quick-add-issue";
import { ownerLabel } from "@/lib/user-name";

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
  // Teams this rock is shared with. Must flow through to RockRow — the edit
  // modal seeds its share picker from it, and saving without it wipes the
  // field on the rock doc.
  shared_team_ids?: string[] | null;
  // Timestamp from onSnapshot, absent from the server prefetch (which
  // filters archived rocks out entirely). Only ever read as truthy.
  archived_at?: unknown;
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

// created_at is a Firestore Timestamp over onSnapshot; toMillis() is the only
// thing we read off it.
type StatusUpdateDoc = {
  id: string;
  team_id: string;
  rock_id: string;
  status: string;
  comment: string | null;
  user_id: string | null;
  created_at: { toMillis?: () => number } | null;
};

type Member = { user_id: string; full_name: string };

export function SegmentRocks({
  teamId,
  meetingId,
  userId,
  defaultDue,
  initialRocks,
  initialTodos,
  members,
  initialAbsentUserIds,
  initialSpeakingOrder,
  initialSpeakerIndex,
  teamName,
  shareTeams,
  allTeams = [],
  extraOwnerNames = [],
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  defaultDue: string;
  initialRocks: RockDoc[];
  initialTodos: TodoDoc[];
  members: Member[];
  initialAbsentUserIds: string[];
  initialSpeakingOrder: string[];
  initialSpeakerIndex: number;
  teamName: string;
  shareTeams: { id: string; name: string }[];
  allTeams?: { id: string; name: string }[];
  extraOwnerNames?: { user_id: string; full_name: string }[];
}) {
  const db = getClientDb();

  const rocksQuery = useMemo(
    () => fsQuery(collection(db, "rocks"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  const sharedRocksQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "rocks"),
        where("shared_team_ids", "array-contains", teamId),
      ),
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

  // Status notes power the "latest status note" line in the expanded row, so
  // the meeting sees the same context the Rocks tab does. Append-only and
  // client-readable by team members (firestore.rules).
  const statusQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "rock_status_updates"),
        where("team_id", "==", teamId),
      ),
    [db, teamId],
  );

  const initialHome = useMemo(
    () => initialRocks.filter((r) => r.team_id === teamId),
    [initialRocks, teamId],
  );
  const initialShared = useMemo(
    () => initialRocks.filter((r) => isSharedIntoTeam(r, teamId)),
    [initialRocks, teamId],
  );
  const homeRocks = useCollection<RockDoc>(rocksQuery, initialHome);
  const sharedRocksLive = useCollection<RockDoc>(
    sharedRocksQuery,
    initialShared,
    "shared-rocks",
  );
  const liveTodos = useCollection<TodoDoc>(todosQuery, initialTodos);
  const statusUpdates = useCollection<StatusUpdateDoc>(statusQuery, []);
  const extraTodos = useMemo(
    () => initialTodos.filter((t) => t.team_id !== teamId),
    [initialTodos, teamId],
  );
  const todos = useMemo(() => {
    const seen = new Set(liveTodos.map((t) => t.id));
    return [
      ...liveTodos,
      ...extraTodos.filter((t) => !seen.has(t.id)),
    ];
  }, [liveTodos, extraTodos]);

  // Active and archived as two lists, not one filtered by a flag: the speaking
  // order, department grouping and counts below all read `rocks`, and only the
  // active set belongs in them (N24). Archived rocks are reachable in-meeting
  // via the toggle — the client asked for the view in both modes on 2026-08-12,
  // which retired the old "archived belongs to the Rocks tab" rule.
  const dedupe = (home: RockDoc[], shared: RockDoc[]) => {
    const seen = new Set(home.map((r) => r.id));
    return [...home, ...shared.filter((r) => !seen.has(r.id))];
  };
  const rocks = useMemo(
    () =>
      dedupe(
        homeRocks.filter((r) => r.archived_at == null),
        sharedRocksLive.filter(
          (r) => r.archived_at == null && isSharedIntoTeam(r, teamId),
        ),
      ),
    [homeRocks, sharedRocksLive, teamId],
  );
  const archivedRocks = useMemo(
    () =>
      dedupe(
        homeRocks.filter((r) => r.archived_at != null),
        sharedRocksLive.filter(
          (r) => r.archived_at != null && isSharedIntoTeam(r, teamId),
        ),
      ),
    [homeRocks, sharedRocksLive, teamId],
  );
  // Resets on unmount, by design (N24) — Active is the room's default.
  const [showArchived, setShowArchived] = useState(false);

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

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  for (const n of extraOwnerNames) nameById.set(n.user_id, n.full_name);
  const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]));

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

  const statusByRock = new Map<string, StatusUpdateSerialized[]>();
  for (const u of statusUpdates) {
    if (!u.rock_id) continue;
    const list = statusByRock.get(u.rock_id) ?? [];
    list.push({
      id: u.id,
      status: String(u.status ?? ""),
      comment: u.comment ?? null,
      user_id: u.user_id ?? null,
      created_at_ms: u.created_at?.toMillis?.() ?? null,
      author_name: u.user_id ? (nameById.get(u.user_id) ?? "—") : "—",
    });
    statusByRock.set(u.rock_id, list);
  }
  for (const list of statusByRock.values()) {
    list.sort((a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0));
  }

  // Show every non-cancelled rock. This used to filter on
  // r.quarter === currentQuarter(), but `quarter` is a free-text label —
  // imported rocks carry the client's own fiscal wording ("Q2 FY 2026"),
  // which never string-matches "2026-Q3", so the segment rendered empty
  // while the Rocks tab (which doesn't filter) looked fine. The meeting
  // reviews the rocks the team actually has; cancelled ones stay out.
  // Archived view shows them as they are — a cancelled rock that was archived
  // is exactly the kind of thing someone opens this view to find.
  const visible = showArchived
    ? archivedRocks
    : rocks.filter((r) => r.status !== "cancelled");
  const homeVisible = visible.filter((r) => r.team_id === teamId);
  const sharedVisible = visible.filter((r) => isSharedIntoTeam(r, teamId));
  const groups = groupRocksForL10(
    homeVisible,
    isDepartmentRock,
    members,
    speakingOrder,
    absent,
    currentSpeaker,
    DEPARTMENT_SECTION_TITLE,
  );
  const sharedGroups = groupSharedRocksByOwner(sharedVisible, (id) =>
    id ? (nameById.get(id) ?? "—") : "—",
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {homeVisible.length + sharedVisible.length} rock
          {homeVisible.length + sharedVisible.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2">
          <EntityViewToggle
            showArchived={showArchived}
            onChange={setShowArchived}
            activeCount={rocks.filter((r) => r.status !== "cancelled").length}
            archivedCount={archivedRocks.length}
          />
          <QuickAddIssue
            teamId={teamId}
            prefill="Off-track rock: "
            meetingId={meetingId}
          />
        </div>
      </div>

      {groups.length === 0 && sharedGroups.length === 0 && (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {showArchived
            ? "No archived rocks."
            : "No rocks yet — add them on the Rocks tab."}
        </div>
      )}

      {/* One card per section, owner in the card header — the header row
          carries the speaker state (green header + chip) instead of ringing
          the whole card, which shouted over the content. */}
      {groups.map((g) => (
        <section
          key={g.key}
          className={
            "overflow-hidden rounded-xl border bg-white dark:bg-zinc-900 " +
            (g.isCurrentSpeaker
              ? "border-hpb-green/50"
              : "border-zinc-300 dark:border-zinc-800") +
            (g.absent ? " opacity-60" : "")
          }
        >
          <header
            className={
              "flex items-center gap-2 border-b px-4 py-2 " +
              (g.isCurrentSpeaker
                ? "border-hpb-green/30 bg-hpb-green/5 dark:bg-hpb-green/10"
                : "border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50")
            }
          >
            <span
              className={
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                (g.isCurrentSpeaker
                  ? "bg-hpb-green text-white"
                  : "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold")
              }
            >
              {g.isDepartmentSection ? (
                <Users className="h-3.5 w-3.5" />
              ) : (
                initials(g.title) || "?"
              )}
            </span>
            <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
              {g.title}
            </h3>
            <span className="text-xs text-zinc-500">{g.rocks.length}</span>
            {g.isCurrentSpeaker && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-hpb-green/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-hpb-green ring-1 ring-inset ring-hpb-green/30">
                <span className="h-1.5 w-1.5 rounded-full bg-hpb-green" />
                Now speaking
              </span>
            )}
            {g.absent && !g.isCurrentSpeaker && (
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Absent
              </span>
            )}
          </header>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.rocks.map((r) => (
              <RockRow
                key={r.id}
                teamId={teamId}
                userId={userId}
                rock={r}
                ownerName={
                  ownerLabel(r.owner_id, (id) => nameById.get(id))
                }
                members={members}
                milestones={milestonesByRock.get(r.id) ?? []}
                defaultDue={defaultDue}
                statusHistory={statusByRock.get(r.id) ?? []}
                currentUserId={userId}
                teamName={teamName}
                shareTeams={shareTeams}
              />
            ))}
          </div>
        </section>
      ))}

      {sharedGroups.map((g) => (
        <section
          key={`shared-${g.ownerId ?? "none"}`}
          className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <header className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
            <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
              {g.title}
            </h3>
            <span className="text-xs text-zinc-500">{g.rocks.length}</span>
          </header>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.rocks.map((r) => (
              <RockRow
                key={r.id}
                teamId={teamId}
                userId={userId}
                rock={r}
                ownerName={
                  ownerLabel(r.owner_id, (id) => nameById.get(id))
                }
                members={members}
                milestones={milestonesByRock.get(r.id) ?? []}
                defaultDue={defaultDue}
                statusHistory={statusByRock.get(r.id) ?? []}
                currentUserId={userId}
                teamName={teamNameById.get(r.team_id) ?? "another team"}
                shareTeams={shareTeams}
                readOnly
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

