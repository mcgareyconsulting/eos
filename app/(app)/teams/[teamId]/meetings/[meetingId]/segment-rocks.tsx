"use client";

import { useMemo, useState } from "react";
import { collection, doc, query as fsQuery, where } from "firebase/firestore";
import { Archive, Users } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import { initials } from "@/lib/initials";
import {
  currentSpeakerUid,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import {
  groupRocksForL10,
  sortRocksForSection,
} from "@/lib/l10/rock-order";
import {
  DEPARTMENT_SECTION_TITLE,
  isDepartmentRock,
} from "../../rocks/rock-type";
import { RockRow } from "../../rocks/rock-row";
import { type MilestoneSerialized } from "../../rocks/milestone-checklist";
import { type StatusUpdateSerialized } from "../../rocks/status-history";
import { QuickAddIssue } from "@/components/quick-add-issue";
import { EmptyState } from "@/components/empty-state";
import { EntityViewToggle } from "@/components/entity-view-toggle";

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
  // Timestamp from onSnapshot, millis from the server prefetch (raw
  // Timestamps can't cross the RSC boundary). Only ever read as truthy —
  // it splits the Active | Archived views.
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
}) {
  const db = getClientDb();

  // Active | Archived view — local state (no navigation mid-meeting),
  // mirroring the standalone Rocks tab's tabs.
  const [showArchived, setShowArchived] = useState(false);

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

  const homeRocks = useCollection<RockDoc>(rocksQuery, initialRocks);
  const todos = useCollection<TodoDoc>(todosQuery, initialTodos);
  const statusUpdates = useCollection<StatusUpdateDoc>(statusQuery, []);

  // The Active view keeps archived rocks out of the walk; the Archived
  // view is exactly that remainder (with restore via the row's archive
  // toggle, same as the Rocks tab).
  const rocks = useMemo(
    () => homeRocks.filter((r) => r.archived_at == null),
    [homeRocks],
  );
  const archivedRocks = useMemo(
    () => homeRocks.filter((r) => r.archived_at != null),
    [homeRocks],
  );

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
  const visible = rocks.filter((r) => r.status !== "cancelled");
  const groups = groupRocksForL10(
    visible,
    isDepartmentRock,
    members,
    speakingOrder,
    absent,
    currentSpeaker,
    DEPARTMENT_SECTION_TITLE,
  );

  // Archived view mirrors the standalone Rocks tab's Archived tab
  // (rocks/page.tsx buildSections): Department section first, then members
  // A–Z, then owners no longer on the roster. No speaking rail — nobody
  // presents archived rocks.
  const rosterIds = new Set(members.map((m) => m.user_id));
  const archivedGroups: { key: string; title: string; rocks: RockDoc[] }[] =
    [];
  if (showArchived) {
    const deptRocks: RockDoc[] = [];
    const byOwner = new Map<string, RockDoc[]>();
    for (const r of archivedRocks) {
      if (isDepartmentRock(r)) {
        deptRocks.push(r);
        continue;
      }
      const id = r.owner_id as string;
      const list = byOwner.get(id) ?? [];
      list.push(r);
      byOwner.set(id, list);
    }
    if (deptRocks.length > 0) {
      archivedGroups.push({
        key: "department",
        title: DEPARTMENT_SECTION_TITLE,
        rocks: sortRocksForSection(deptRocks),
      });
    }
    const named = [...members].sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    );
    for (const m of named) {
      const list = byOwner.get(m.user_id);
      if (!list || list.length === 0) continue;
      archivedGroups.push({
        key: m.user_id,
        title: m.full_name,
        rocks: sortRocksForSection(list),
      });
    }
    // Owners not on the current roster (left the team, stale id).
    const orphanIds = [...byOwner.keys()].filter((id) => !rosterIds.has(id));
    orphanIds.sort((a, b) =>
      (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—"),
    );
    for (const id of orphanIds) {
      archivedGroups.push({
        key: id,
        title: nameById.get(id) ?? "—",
        rocks: sortRocksForSection(byOwner.get(id)!),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <EntityViewToggle
          showArchived={showArchived}
          onChange={setShowArchived}
          activeCount={visible.length}
          archivedCount={archivedRocks.length}
        />
        <QuickAddIssue
          teamId={teamId}
          prefill="Off-track rock: "
          meetingId={meetingId}
        />
      </div>

      {showArchived && archivedGroups.length === 0 && (
        <div className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <EmptyState
            icon={Archive}
            title="No archived rocks"
            hint="Nothing archived yet. Rocks marked Done before this week’s Monday land here after the overnight sweep."
          />
        </div>
      )}

      {/* Same section layout as the Rocks tab's Archived view — uppercase
          owner label above a divided card of rows; restore works from the
          row's archive toggle. */}
      {showArchived &&
        archivedGroups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
              {g.title}
              <span className="font-bold text-zinc-400">
                {" "}
                ({g.rocks.length})
              </span>
            </h2>
            <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {g.rocks.map((r) => (
                <RockRow
                  key={r.id}
                  teamId={teamId}
                  userId={userId}
                  rock={r}
                  ownerName={
                    r.owner_id ? (nameById.get(r.owner_id) ?? "—") : "—"
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

      {!showArchived && groups.length === 0 && (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
          No rocks yet — add them on the Rocks tab.
        </div>
      )}

      {/* One card per section, owner in the card header — the header row
          carries the speaker state (green header + chip) instead of ringing
          the whole card, which shouted over the content. */}
      {!showArchived &&
        groups.map((g) => (
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
                    r.owner_id ? (nameById.get(r.owner_id) ?? "—") : "—"
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
    </div>
  );
}

