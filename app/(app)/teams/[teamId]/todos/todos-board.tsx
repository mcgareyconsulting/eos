"use client";

import { useMemo } from "react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { Archive, CheckSquare, Flag } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { BoardColumn } from "@/components/board-column";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { SyncGoogleTasksButton } from "@/components/sync-google-tasks-button";
import { initials } from "@/lib/initials";
import {
  MILESTONE_REMINDER_DAYS,
  isMilestoneDueSoon,
  isMilestoneHiddenByRock,
} from "@/lib/milestone-visibility";
import { ownerLabel } from "@/lib/user-name";
import { AddTodoModal } from "./add-todo-modal";
import { MilestoneTodoRow, type MilestoneTodoItem } from "./milestone-todo-row";
import { TodoListRow, type TodoListItem } from "./todo-list-row";

/**
 * The To-Dos tab, live.
 *
 * N51 (Jessica): "when you add a to-do, it does not show up until you refresh
 * ... so I don't forget and add it twice." The obvious reading — that a
 * refresh is missing — is wrong: `addTodo` already revalidates both this path
 * and /home, and `AddTodoModal` already awaits the action and calls
 * `router.refresh()`. What was actually singular about this surface is that it
 * was the ONLY entity tab with no realtime listener. Issues, every meeting
 * segment and comments all subscribe; To-Dos was a server component leaning on
 * revalidation, so it inherited every way revalidation can lose a race (a slow
 * Google Tasks mirror inside the same action, a second tab, a teammate adding
 * during your L10) with no second chance to repaint.
 *
 * So this does not add another refresh. It puts the tab on the same listener
 * the in-meeting To-Dos segment has always used, which makes the whole class
 * of report impossible rather than fixing one instance of it.
 *
 * Two subscriptions, merged: the `todos` rule rejects a list query unless it
 * can prove every result is readable, which means constraining `visibility` or
 * `owner_id`. Identical to `segment-todos.tsx` — deliberately, so the two
 * surfaces cannot drift into disagreeing about what a to-do is. The two result
 * sets are disjoint by construction (a doc is team or private, never both), so
 * concatenating them cannot duplicate a row.
 */

// completed_at / archived_at arrive as a Firestore Timestamp live, and as the
// plain projections below on the server pass. Both are read through helpers
// that accept either.
export type TodoBoardDoc = {
  id: string;
  title: string;
  description?: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed_at: unknown;
  archived_at: unknown;
  visibility: "team" | "private";
  source_rock_id: string | null;
};

export type RockBoardDoc = {
  id: string;
  title?: string | null;
  status?: string | null;
  archived_at?: unknown;
};

type Member = { user_id: string; full_name: string };

type OwnerBucket<T> = { key: string; title: string; items: T[] };
type OwnerGroup = {
  key: string;
  title: string;
  open: TodoListItem[];
  done: TodoListItem[];
};

/** Firestore Timestamp / millis / server projection → local m/d/yyyy. */
function formatClosedOn(archived_at: unknown): string | null {
  if (archived_at == null) return null;
  let d: Date | null = null;
  const v = archived_at as {
    toDate?: () => Date;
    toMillis?: () => number;
  };
  if (typeof v.toDate === "function") d = v.toDate();
  else if (typeof v.toMillis === "function") d = new Date(v.toMillis());
  else if (typeof archived_at === "number") d = new Date(archived_at);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function byDue<T extends { due_date: string | null }>(a: T, b: T) {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

/**
 * One card per owner (same idea as L10). Order = team speaking order, then
 * alphabetical for anyone off the order, then Unassigned. Both board columns
 * group this way so the two sides line up owner-for-owner.
 * Input order is preserved inside each bucket — sort before calling.
 */
function groupByOwner<T extends { owner_id: string | null }>(
  items: T[],
  members: Member[],
  speakingOrder: string[],
): OwnerBucket<T>[] {
  const byOwner = new Map<string, T[]>();
  const unassigned: T[] = [];

  for (const t of items) {
    if (!t.owner_id) {
      unassigned.push(t);
      continue;
    }
    const list = byOwner.get(t.owner_id) ?? [];
    list.push(t);
    byOwner.set(t.owner_id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const placed = new Set<string>();
  const buckets: OwnerBucket<T>[] = [];

  const pushOwner = (uid: string) => {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) return;
    placed.add(uid);
    buckets.push({ key: uid, title: nameById.get(uid) ?? "—", items: list });
  };

  for (const uid of speakingOrder) pushOwner(uid);

  const orphans = [...byOwner.keys()].filter((id) => !placed.has(id));
  orphans.sort((a, b) =>
    (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—"),
  );
  for (const uid of orphans) pushOwner(uid);

  if (unassigned.length > 0) {
    buckets.push({ key: "unassigned", title: "Unassigned", items: unassigned });
  }

  return buckets;
}

/** Owner cards for the To-Dos column, each split into open / done-this-week. */
function groupTodosByOwner(
  todos: TodoListItem[],
  members: Member[],
  speakingOrder: string[],
): OwnerGroup[] {
  return groupByOwner(todos, members, speakingOrder).map((b) => ({
    key: b.key,
    title: b.title,
    open: b.items.filter((t) => !t.completed).sort(byDue),
    done: b.items.filter((t) => t.completed).sort(byDue),
  }));
}

export function TodosBoard({
  teamId,
  userId,
  showArchived,
  ownerFilter,
  members,
  speakingOrder,
  tasksStatus,
  initialTodos,
  initialRocks,
}: {
  teamId: string;
  userId: string;
  showArchived: boolean;
  /** A member user_id, or "all". Validated against the roster on the server. */
  ownerFilter: string;
  members: Member[];
  speakingOrder: string[];
  tasksStatus: { configured: boolean; connected: boolean };
  initialTodos: TodoBoardDoc[];
  initialRocks: RockBoardDoc[];
}) {
  const db = getClientDb();

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
  const rocksQuery = useMemo(
    () => fsQuery(collection(db, "rocks"), where("team_id", "==", teamId)),
    [db, teamId],
  );

  const initialTeam = useMemo(
    () => initialTodos.filter((t) => t.visibility === "team"),
    [initialTodos],
  );
  const initialMine = useMemo(
    () =>
      initialTodos.filter(
        (t) => t.visibility === "private" && t.owner_id === userId,
      ),
    [initialTodos, userId],
  );

  const teamTodos = useCollection<TodoBoardDoc>(teamQuery, initialTeam, "todos-team");
  const myTodos = useCollection<TodoBoardDoc>(mineQuery, initialMine, "todos-mine");
  const rocks = useCollection<RockBoardDoc>(rocksQuery, initialRocks, "todos-rocks");

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

  const allRaw = useMemo(
    () => [...teamTodos, ...myTodos],
    [teamTodos, myTodos],
  );

  // Split the subscription into the two lists the page renders. Milestones
  // (to-dos carrying a source_rock_id) are their own column and are dropped
  // once their parent rock is done/cancelled/archived — same rule the L10
  // segment and Home apply.
  const { allTodos, allMilestones } = useMemo(() => {
    const todos: TodoListItem[] = [];
    const milestones: MilestoneTodoItem[] = [];
    for (const t of allRaw) {
      const archived = t.archived_at != null;
      if (t.source_rock_id) {
        const rock = rockById.get(t.source_rock_id);
        if (isMilestoneHiddenByRock(rock)) continue;
        if (t.completed_at || archived) continue;
        milestones.push({
          id: t.id,
          title: t.title,
          owner_id: t.owner_id ?? null,
          due_date: t.due_date ?? null,
          completed: false,
          rock_title: rock?.title ?? "Rock",
        });
        continue;
      }
      todos.push({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        owner_id: t.owner_id ?? null,
        due_date: t.due_date ?? null,
        completed: !!t.completed_at,
        visibility: t.visibility === "private" ? "private" : "team",
        archived,
        closed_on: formatClosedOn(t.archived_at),
      });
    }
    return { allTodos: todos, allMilestones: milestones };
  }, [allRaw, rockById]);

  const activeTodos = allTodos.filter((t) => !t.archived);
  const archivedTodos = allTodos.filter((t) => t.archived);
  const scoped = (list: TodoListItem[]) =>
    ownerFilter === "all"
      ? list
      : list.filter((t) => t.owner_id === ownerFilter);
  const todos = scoped(showArchived ? archivedTodos : activeTodos);

  // N29: this column is a REMINDER, not an inventory. Two rules —
  //  1. only what is due inside the two-week window (overdue included), and
  //  2. with no explicit owner filter, only the viewer's own.
  // Before this, every open milestone on the team rendered here and pushed
  // the actual to-dos below the fold. An explicit owner filter still wins,
  // so the control keeps working rather than becoming decorative.
  const visibleMilestones = allMilestones
    .filter((m) =>
      ownerFilter === "all" ? m.owner_id === userId : m.owner_id === ownerFilter,
    )
    .filter((m) => isMilestoneDueSoon(m.due_date))
    .sort(byDue);
  const milestoneScopeIsSelf = ownerFilter === "all";

  const ownerName = (id: string | null) =>
    ownerLabel(id, (x) => members.find((m) => m.user_id === x)?.full_name);

  // Active: owner cards (open + done-this-week). Archived: flat list only —
  // owner cards with "0 · N done" + a DONE strip are noise when everything is
  // already done/archived (and the open count is always 0).
  const groups = showArchived
    ? []
    : groupTodosByOwner(todos, members, speakingOrder);
  const openCount = groups.reduce((n, g) => n + g.open.length, 0);
  // visibleMilestones is already due-sorted; groupByOwner keeps that order.
  const milestoneGroups = groupByOwner(
    visibleMilestones,
    members,
    speakingOrder,
  );
  const archivedFlat = showArchived
    ? [...todos].sort((a, b) => {
        const byOwnerName = ownerName(a.owner_id).localeCompare(
          ownerName(b.owner_id),
        );
        if (byOwnerName !== 0) return byOwnerName;
        return byDue(a, b);
      })
    : [];

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title="To-Dos"
        leading={
          <SyncGoogleTasksButton
            configured={tasksStatus.configured}
            connected={tasksStatus.connected}
            showHint={false}
          />
        }
        filter={<OwnerFilter members={members} currentUserId={userId} />}
        tabs={
          // Counts come off the live lists, not the server pass — a stale
          // "Active (7)" beside a list of 8 is the same bug wearing a hat.
          <EntityViewTabs
            basePath={`/teams/${teamId}/todos`}
            showArchived={showArchived}
            activeCount={activeTodos.length}
            archivedCount={archivedTodos.length}
            owner={ownerFilter !== "all" ? ownerFilter : undefined}
          />
        }
        add={
          <AddTodoModal
            teamId={teamId}
            members={members}
            defaultOwnerId={userId}
          />
        }
      />

      {showArchived ? (
        <BoardColumn title="To-Dos" count={archivedFlat.length}>
          {archivedFlat.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="No archived to-dos"
              hint="Completed to-dos archive when an L10 ends, or archive them manually."
            />
          ) : (
            archivedFlat.map((t) => (
              <TodoListRow
                key={t.id}
                teamId={teamId}
                todo={t}
                ownerName={ownerName(t.owner_id)}
                members={members}
              />
            ))
          )}
        </BoardColumn>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
          <BoardColumn
            title="To-Dos"
            count={todos.length}
            meta={
              openCount > 0 && openCount !== todos.length
                ? `${openCount} open`
                : undefined
            }
          >
            {groups.length === 0 && (
              <EmptyState
                icon={CheckSquare}
                title="No to-dos yet"
                hint="Add a to-do, or capture one during the Level 10."
              />
            )}
            {openCount === 0 && groups.some((g) => g.done.length > 0) && (
              <p className="px-4 py-2 text-center text-sm text-hpb-green">
                All to-dos done — they archive when the L10 ends.
              </p>
            )}
            {groups.map((g) => (
              <div key={g.key}>
                <GroupHeader
                  chip={initials(g.title) || "?"}
                  title={g.title}
                  count={
                    [
                      g.open.length > 0 ? `${g.open.length} open` : null,
                      g.done.length > 0 ? `${g.done.length} done` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "none"
                  }
                />
                {g.open.map((t) => (
                  <TodoListRow
                    key={t.id}
                    teamId={teamId}
                    todo={t}
                    ownerName={g.title}
                    members={members}
                    hideOwner
                  />
                ))}
                {/* No "Done" divider: the row's green check already reads as
                    done, and the owner header above counts them. */}
                {g.done.map((t) => (
                  <TodoListRow
                    key={t.id}
                    teamId={teamId}
                    todo={t}
                    ownerName={g.title}
                    members={members}
                    hideOwner
                  />
                ))}
              </div>
            ))}
          </BoardColumn>

          <BoardColumn
            title={milestoneScopeIsSelf ? "Your milestones" : "Milestones"}
            count={visibleMilestones.length}
          >
            {visibleMilestones.length === 0 ? (
              <EmptyState
                icon={Flag}
                title={`Nothing due in the next ${MILESTONE_REMINDER_DAYS} days`}
                hint={
                  milestoneScopeIsSelf
                    ? "Your rock milestones appear here as they come due. Everything else stays under its rock on the Rocks tab."
                    : "Milestones appear here as they come due. Everything else stays under its rock on the Rocks tab."
                }
              />
            ) : (
              milestoneGroups.map((g) => (
                <div key={g.key}>
                  <GroupHeader
                    chip={initials(g.title) || "?"}
                    title={g.title}
                    count={`${g.items.length}`}
                  />
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
              ))
            )}
          </BoardColumn>
        </div>
      )}
    </div>
  );
}

/**
 * Section header shared by both board columns: a square chip, the group name,
 * and a muted count. Owner cards pass initials, rock sections pass a glyph.
 */
function GroupHeader({
  chip,
  title,
  count,
}: {
  chip: React.ReactNode;
  title: string;
  count: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold">
        {chip}
      </span>
      <h3
        className="min-w-0 truncate text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200"
        title={title}
      >
        {title}
      </h3>
      <span className="shrink-0 text-xs text-zinc-500">{count}</span>
    </div>
  );
}
