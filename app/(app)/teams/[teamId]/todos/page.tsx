import { Archive, CheckSquare, Flag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { SyncGoogleTasksButton } from "@/components/sync-google-tasks-button";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { initials } from "@/lib/initials";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import {
  MILESTONE_REMINDER_DAYS,
  isMilestoneDueSoon,
  isMilestoneHiddenByRock,
} from "@/lib/milestone-visibility";
import {
  getTasksStatus,
  pullCompletionsForOwner,
} from "@/lib/google/tasks";
import { AddTodoModal } from "./add-todo-modal";
import {
  MilestoneTodoRow,
  type MilestoneTodoItem,
} from "./milestone-todo-row";
import { TodoListRow, type TodoListItem } from "./todo-list-row";
import { ownerLabel } from "@/lib/user-name";

type TodoDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | null;
  archived_at?: { toDate: () => Date } | null;
  visibility: "team" | "private";
  source_issue_id: string | null;
  source_meeting_id: string | null;
  source_rock_id: string | null;
};

function isArchived(t: { archived_at?: unknown }): boolean {
  return t.archived_at != null;
}

/** Firestore Timestamp (or millis) → local mm/dd/yyyy for "Closed On". */
function formatClosedOn(
  archived_at: { toDate?: () => Date; toMillis?: () => number } | null | undefined,
): string | null {
  if (archived_at == null) return null;
  let d: Date | null = null;
  if (typeof archived_at.toDate === "function") {
    d = archived_at.toDate();
  } else if (typeof archived_at.toMillis === "function") {
    d = new Date(archived_at.toMillis());
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}



type OwnerBucket<T> = {
  key: string;
  title: string;
  items: T[];
};

type OwnerGroup = {
  key: string;
  title: string;
  open: TodoListItem[];
  done: TodoListItem[];
};

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
  members: { user_id: string; full_name: string }[],
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
  members: { user_id: string; full_name: string }[],
  speakingOrder: string[],
): OwnerGroup[] {
  return groupByOwner(todos, members, speakingOrder).map((b) => ({
    key: b.key,
    title: b.title,
    open: b.items.filter((t) => !t.completed).sort(byDue),
    done: b.items.filter((t) => t.completed).sort(byDue),
  }));
}

export default async function TodosPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ archived?: string; owner?: string }>;
}) {
  const { teamId: tid } = await params;
  const { archived: archivedParam, owner: ownerParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db, team } = await requireTeamAccess(tid);
  // Best-effort Google → EOS completion pull for the signed-in user so
  // Tasks completed outside the app show up when opening To-Dos.
  // Soft-fail at the call site too so a Google outage never blanks the list.
  try {
    await pullCompletionsForOwner(uid);
  } catch (e) {
    console.error("[todos] google pull on load failed:", e);
  }
  const tasksStatus = await getTasksStatus(uid);
  const members = await getTeamMembers(tid);
  const speakingOrder = reconcileSpeakingOrder(team.speakingOrder, members);

  const [snap, rocksSnap] = await Promise.all([
    db.collection("todos").where("team_id", "==", tid).get(),
    db.collection("rocks").where("team_id", "==", tid).get(),
  ]);

  const rocksById = new Map(
    rocksSnap.docs.map((d) => {
      const x = d.data();
      return [
        d.id,
        {
          title: String(x.title ?? "Rock"),
          status: String(x.status ?? ""),
          archived_at: x.archived_at ?? null,
        },
      ];
    }),
  );

  // Project plain fields — completed_at is a Timestamp and can't cross the
  // RSC boundary into the client list row.
  const allTodos: TodoListItem[] = [];
  const allMilestones: MilestoneTodoItem[] = [];
  for (const d of snap.docs) {
    const t = d.data() as TodoDoc;
    if (t.source_rock_id) {
      const rock = rocksById.get(t.source_rock_id);
      if (isMilestoneHiddenByRock(rock)) continue;
      if (t.completed_at || isArchived(t)) continue;
      allMilestones.push({
        id: d.id,
        title: t.title,
        owner_id: t.owner_id ?? null,
        due_date: t.due_date ?? null,
        completed: false,
        rock_title: rock?.title ?? "Rock",
      });
      continue;
    }
    const visibility = t.visibility === "private" ? "private" : "team";
    // Private items only for the owner (string-compare; never hide the
    // viewer's own private rows due to a type quirk).
    if (
      visibility === "private" &&
      String(t.owner_id ?? "") !== String(uid)
    ) {
      continue;
    }
    allTodos.push({
      id: d.id,
      title: t.title,
      description: t.description ?? null,
      owner_id: t.owner_id ?? null,
      due_date: t.due_date ?? null,
      completed: !!t.completed_at,
      visibility,
      archived: isArchived(t),
      closed_on: formatClosedOn(t.archived_at),
    });
  }

  const rosterIds = new Set(members.map((m) => m.user_id));
  const filterRaw = ownerParam || "all";
  const legacyMapped =
    filterRaw === "self" || filterRaw === "mine"
      ? uid
      : filterRaw === "team" || filterRaw === "others"
        ? "all"
        : filterRaw;
  const ownerFilter = rosterIds.has(legacyMapped) ? legacyMapped : "all";

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
      ownerFilter === "all"
        ? m.owner_id === uid
        : m.owner_id === ownerFilter,
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
        const byOwner = ownerName(a.owner_id).localeCompare(
          ownerName(b.owner_id),
        );
        if (byOwner !== 0) return byOwner;
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
        filter={<OwnerFilter members={members} currentUserId={uid} />}
        tabs={
          <EntityViewTabs
            basePath={`/teams/${tid}/todos`}
            showArchived={showArchived}
            activeCount={activeTodos.length}
            archivedCount={archivedTodos.length}
            owner={ownerFilter !== "all" ? ownerFilter : undefined}
          />
        }
        add={
          <AddTodoModal
            teamId={tid}
            members={members}
            defaultOwnerId={uid}
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
                teamId={tid}
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
                    teamId={tid}
                    todo={t}
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
                        teamId={tid}
                        todo={t}
                        ownerName={g.title}
                        members={members}
                        hideOwner
                      />
                    ))}
                  </>
                )}
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
                      teamId={tid}
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

function BoardColumn({
  title,
  count,
  meta,
  children,
}: {
  title: string;
  count: number;
  /** Optional breakdown (e.g. "5 open") when `count` alone under-explains. */
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
        {title}{" "}
        <span className="font-bold text-zinc-400">({count})</span>
        {meta && (
          <span className="ml-1.5 font-medium normal-case tracking-normal text-zinc-400">
            · {meta}
          </span>
        )}
      </h2>
      {/* No inner scroller — the page scrolls as one so the two columns
          can't drift out of sync under the reader. */}
      <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </section>
  );
}


