"use client";

import { useMemo, useState } from "react";
import { Flag } from "lucide-react";
import {
  collection,
  doc,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import { initials } from "@/lib/initials";
import {
  currentSpeakerUid,
  ownersPresentThenAbsent,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import {
  MILESTONE_REMINDER_DAYS,
  isMilestoneDueSoon,
  isMilestoneHiddenByRock,
} from "@/lib/milestone-visibility";
import { EmptyState } from "@/components/empty-state";
import {
  TodoListRow,
  type TodoListItem,
} from "../../todos/todo-list-row";
import {
  MilestoneTodoRow,
  type MilestoneTodoItem,
} from "../../todos/milestone-todo-row";
import { EntityViewToggle } from "@/components/entity-view-tabs";
import { AddTodoModal } from "../../todos/add-todo-modal";
import { QuickAddIssue } from "@/components/quick-add-issue";

// completed_at: Timestamp (live) or boolean (server initial) — both truthy-checked.
// description is included so L10 rows mirror the To-Dos tab expand/edit UX.
// archived_at may be missing on legacy docs (treat as active).
type TodoDoc = {
  id: string;
  team_id: string;
  title: string;
  description?: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | boolean | null;
  archived_at?: { toDate: () => Date } | boolean | null;
  visibility: "team" | "private";
  weekly_focus?: boolean;
  source_rock_id: string | null;
};

type Member = { user_id: string; full_name: string };

type RockDoc = {
  id: string;
  title?: string;
  status?: string;
  archived_at?: unknown;
};

type TodoGroup = {
  key: string;
  title: string;
  open: TodoDoc[];
  done: TodoDoc[];
  absent: boolean;
  isCurrentSpeaker: boolean;
};

type MilestoneGroup = {
  key: string;
  title: string;
  items: MilestoneTodoItem[];
};

function toListItem(t: TodoDoc): TodoListItem {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    owner_id: t.owner_id,
    due_date: t.due_date,
    completed: !!t.completed_at,
    visibility: t.visibility === "private" ? "private" : "team",
    weekly_focus: t.weekly_focus === true,
  };
}

function byDue<T extends { due_date: string | null }>(a: T, b: T): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

/**
 * Present speakers, then absentees, then alphabetical for anyone off the
 * roster order — the ordering both to-do and milestone owner cards use so
 * the sections stay in the same speaking order.
 */
function orderOwnerIds(
  ownerIds: Iterable<string>,
  speakingOrder: string[],
  absent: Set<string>,
  nameById: Map<string, string>,
): string[] {
  const idSet = new Set(ownerIds);
  const sectionOrder = ownersPresentThenAbsent(speakingOrder, absent);
  const placed = new Set<string>();
  const ordered: string[] = [];

  for (const uid of sectionOrder) {
    if (idSet.has(uid)) {
      ordered.push(uid);
      placed.add(uid);
    }
  }

  const orphans = [...idSet].filter((id) => !placed.has(id));
  orphans.sort((a, b) => {
    const aAbs = absent.has(a) ? 1 : 0;
    const bAbs = absent.has(b) ? 1 : 0;
    if (aAbs !== bAbs) return aAbs - bAbs;
    return (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—");
  });

  return [...ordered, ...orphans];
}

/**
 * L10 To-Dos: one card per owner (like Rocks). Order = present speakers,
 * then absentees; within each person open then done, each by due date.
 */
function groupTodosForMeeting(
  todos: TodoDoc[],
  members: Member[],
  speakingOrder: string[],
  absent: Set<string>,
  currentSpeaker: string | null,
): TodoGroup[] {
  const byOwner = new Map<string, TodoDoc[]>();
  const unassigned: TodoDoc[] = [];

  for (const t of todos) {
    if (!t.owner_id) {
      unassigned.push(t);
      continue;
    }
    const list = byOwner.get(t.owner_id) ?? [];
    list.push(t);
    byOwner.set(t.owner_id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const groups: TodoGroup[] = [];

  for (const uid of orderOwnerIds(byOwner.keys(), speakingOrder, absent, nameById)) {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) continue;
    groups.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      open: list.filter((t) => !t.completed_at).sort(byDue),
      done: list.filter((t) => t.completed_at).sort(byDue),
      absent: absent.has(uid),
      isCurrentSpeaker: uid === currentSpeaker,
    });
  }

  if (unassigned.length > 0) {
    groups.push({
      key: "unassigned",
      title: "Unassigned",
      open: unassigned.filter((t) => !t.completed_at).sort(byDue),
      done: unassigned.filter((t) => t.completed_at).sort(byDue),
      absent: false,
      isCurrentSpeaker: false,
    });
  }

  return groups;
}

/**
 * Open rock milestones, one owner card each — same speaking-order sequence
 * as `groupTodosForMeeting` (standalone To-Dos groups its Milestones column
 * the same way).
 */
function groupMilestonesForMeeting(
  milestones: MilestoneTodoItem[],
  members: Member[],
  speakingOrder: string[],
  absent: Set<string>,
): MilestoneGroup[] {
  const byOwner = new Map<string, MilestoneTodoItem[]>();
  const unassigned: MilestoneTodoItem[] = [];

  for (const m of milestones) {
    if (!m.owner_id) {
      unassigned.push(m);
      continue;
    }
    const list = byOwner.get(m.owner_id) ?? [];
    list.push(m);
    byOwner.set(m.owner_id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const groups: MilestoneGroup[] = [];

  for (const uid of orderOwnerIds(byOwner.keys(), speakingOrder, absent, nameById)) {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) continue;
    groups.push({ key: uid, title: nameById.get(uid) ?? "—", items: list });
  }

  if (unassigned.length > 0) {
    groups.push({ key: "unassigned", title: "Unassigned", items: unassigned });
  }

  return groups;
}

export function SegmentTodos({
  teamId,
  meetingId,
  userId,
  initialTodos,
  members,
  initialSpeakingOrder = [],
  initialAbsentUserIds = [],
  initialSpeakerIndex = 0,
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  initialTodos: TodoDoc[];
  members: Member[];
  initialSpeakingOrder?: string[];
  initialAbsentUserIds?: string[];
  initialSpeakerIndex?: number;
}) {
  const db = getClientDb();

  // The Firestore rule for todos rejects a list query unless the rule can
  // prove every result is readable: that means we must constrain visibility
  // or owner_id. Run two subscriptions and merge.
  const teamQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "todos"),
        where("team_id", "==", teamId),
        where("visibility", "==", "team"),
      ),
    [db, teamId],
  );
  const mineQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "todos"),
        where("team_id", "==", teamId),
        where("visibility", "==", "private"),
        where("owner_id", "==", userId),
      ),
    [db, teamId, userId],
  );

  const initialTeam = initialTodos.filter((t) => t.visibility === "team");
  const initialMine = initialTodos.filter(
    (t) => t.visibility === "private" && t.owner_id === userId,
  );
  const teamTodos = useCollection<TodoDoc>(teamQuery, initialTeam);
  const myTodos = useCollection<TodoDoc>(mineQuery, initialMine);

  // Rock title + status/archived_at for milestone rows and the
  // isMilestoneHiddenByRock check (same pattern as standalone To-Dos).
  const rocksQuery = useMemo(
    () => fsQuery(collection(db, "rocks"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  const rocks = useCollection<RockDoc>(rocksQuery, []);
  const rockById = useMemo(
    () =>
      new Map(
        rocks.map((r) => [
          r.id,
          {
            title: String(r.title ?? "Rock"),
            status: r.status ?? null,
            archived_at: r.archived_at ?? null,
          },
        ]),
      ),
    [rocks],
  );

  // Live speaking order + attendance so sections reorder when Segue marks absent.
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
    "segment-todos",
  );
  const speakingOrder = reconcileSpeakingOrder(meeting.speaking_order, members);
  const absentUserIds = meeting.absent_user_ids ?? [];
  const absent = new Set(absentUserIds);
  const currentSpeaker = currentSpeakerUid(
    speakingOrder,
    meeting.speaking_index ?? 0,
    absentUserIds,
  );

  // Resets on unmount, by design (N24) — Active is the room's default.
  const [showArchived, setShowArchived] = useState(false);
  const allRawTodos = [...teamTodos, ...myTodos];
  const allTodos = allRawTodos.filter((t) => !t.archived_at);
  // Archived pure to-dos, kept as their own list so nothing derived (counts,
  // the milestone window, speaking-order grouping) can read the wrong one.
  // Milestones are excluded: they are managed under Rocks and `setTodoArchived`
  // refuses them outright, so an archived-milestone view would be a dead end.
  const archivedTodos = allRawTodos.filter(
    (t) => t.archived_at && !t.source_rock_id,
  );
  // Pure to-dos only in owner cards. Milestones surface in their own section
  // (P0-4 / P14-4) — same idea as standalone To-Dos; still editable under
  // Rocks. Milestones whose parent rock is done/cancelled/archived are
  // dropped, same as the standalone Milestones column.
  //
  // N29: unlike the standalone tab this stays TEAM-wide rather than scoping
  // to the viewer — Jessica, on this surface specifically: "in this view I
  // would say it's better to see everyone's milestone, so if you know
  // something's coming up for someone else you can push them on it if you
  // think they're not ready." What it does share is the two-week window, so
  // the section reads as what the room needs to chase this fortnight.
  const pureTodos = allTodos.filter((t) => !t.source_rock_id);
  const openMilestones: MilestoneTodoItem[] = allTodos
    .filter(
      (t) =>
        Boolean(t.source_rock_id) &&
        !t.completed_at &&
        isMilestoneDueSoon(t.due_date) &&
        !isMilestoneHiddenByRock(rockById.get(t.source_rock_id ?? "")),
    )
    .sort(byDue)
    .map((t) => ({
      id: t.id,
      title: t.title,
      owner_id: t.owner_id,
      due_date: t.due_date,
      completed: false,
      rock_title: rockById.get(t.source_rock_id ?? "")?.title ?? "Rock",
    }));

  const groups = groupTodosForMeeting(
    showArchived ? archivedTodos : pureTodos,
    members,
    speakingOrder,
    absent,
    currentSpeaker,
  );
  const milestoneGroups = groupMilestonesForMeeting(
    openMilestones,
    members,
    speakingOrder,
    absent,
  );

  const openCount = groups.reduce((n, g) => n + g.open.length, 0);
  const doneCount = groups.reduce((n, g) => n + g.done.length, 0);
  // Counts on the toggle describe the lists themselves, not the current view.
  const activeTodoCount = pureTodos.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <EntityViewToggle
          showArchived={showArchived}
          onChange={setShowArchived}
          activeCount={activeTodoCount}
          archivedCount={archivedTodos.length}
        />
        <AddTodoModal
          teamId={teamId}
          members={members}
          defaultOwnerId={userId}
          meetingId={meetingId}
          compact
        />
        <QuickAddIssue
          teamId={teamId}
          prefill="Stale to-do: "
          meetingId={meetingId}
        />
      </div>

      {/* N29: two columns, matching the standalone To-Dos page — and
          to-dos FIRST. Stacked, the milestone block sat on top and
          pushed the actual to-dos below the fold ("just vomit at the
          top of the to-dos page, so you got to scroll to the bottom").
          Stacks again under lg so a narrow meeting window still reads. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
        {groups.length === 0 && (
          <div className="rounded-xl border border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {showArchived
              ? "No archived to-dos."
              : "No to-dos."}
          </div>
        )}

        {openCount === 0 && doneCount > 0 && (
          <div className="rounded-lg border border-hpb-green/30 bg-hpb-green/5 px-4 py-2 text-center text-sm text-hpb-green">
            All to-dos done — nice week.
          </div>
        )}

        {/* One card per owner — same chrome as L10 Rocks. */}
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
                  : "border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50")
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
                {initials(g.title) || "?"}
              </span>
              <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
                {g.title}
              </h3>
              <span className="text-xs text-zinc-500">
                {[
                  g.open.length > 0 ? `${g.open.length} open` : null,
                  g.done.length > 0 ? `${g.done.length} done` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "none"}
              </span>
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
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {g.open.length === 0 && g.done.length === 0 && (
                <div className="px-4 py-3 text-sm text-zinc-500">No to-dos</div>
              )}
              {g.open.map((t) => (
                <TodoListRow
                  key={t.id}
                  teamId={teamId}
                  todo={toListItem(t)}
                  ownerName={g.title}
                  members={members}
                  hideOwner
                />
              ))}
              {g.done.length > 0 && (
                <>
                  <div className="bg-zinc-50 px-4 py-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-500">
                    Done
                  </div>
                  {g.done.map((t) => (
                    <TodoListRow
                      key={t.id}
                      teamId={teamId}
                      todo={toListItem(t)}
                      ownerName={g.title}
                      members={members}
                      hideOwner
                    />
                  ))}
                </>
              )}
            </div>
          </section>
        ))}
        </div>

        <div className="space-y-3">
        <section className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <header className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
            <Flag className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
            <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
              Milestones
            </h3>
            <span className="text-xs text-zinc-500">
              {openMilestones.length}
            </span>
            <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">
              due in the next {MILESTONE_REMINDER_DAYS} days
            </span>
          </header>
          {openMilestones.length === 0 ? (
            <EmptyState
              icon={Flag}
              title={`Nothing due in the next ${MILESTONE_REMINDER_DAYS} days`}
              hint="Milestones further out stay under their rock on the Rocks segment."
            />
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {milestoneGroups.map((g) => (
                <div key={g.key}>
                  <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold">
                      {initials(g.title) || "?"}
                    </span>
                    <h4 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
                      {g.title}
                    </h4>
                    <span className="text-xs text-zinc-500">
                      {g.items.length}
                    </span>
                  </div>
                  {g.items.map((m) => (
                    <MilestoneTodoRow
                      key={m.id}
                      teamId={teamId}
                      milestone={m}
                      ownerName={g.title}
                      hideOwner
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
