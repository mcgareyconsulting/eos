import { Archive, CheckSquare, Flag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { SyncGoogleTasksButton } from "@/components/sync-google-tasks-button";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { initials } from "@/lib/initials";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { isMilestoneHiddenByRock } from "@/lib/milestone-visibility";
import {
  getTasksStatus,
  pullCompletionsForOwner,
} from "@/lib/google/tasks";
import { cn } from "@/lib/utils";
import { AddTodoModal } from "./add-todo-modal";
import {
  MilestoneTodoRow,
  type MilestoneTodoItem,
} from "./milestone-todo-row";
import { TodoListRow, type TodoListItem } from "./todo-list-row";

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

/** One card per owner (same idea as L10). Order = team speaking order. */
function groupTodosByOwner(
  todos: TodoListItem[],
  members: { user_id: string; full_name: string }[],
  speakingOrder: string[],
): OwnerGroup[] {
  const byOwner = new Map<string, TodoListItem[]>();
  const unassigned: TodoListItem[] = [];

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
  const placed = new Set<string>();
  const groups: OwnerGroup[] = [];

  const pushOwner = (uid: string) => {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) return;
    placed.add(uid);
    groups.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      open: list.filter((t) => !t.completed).sort(byDue),
      done: list.filter((t) => t.completed).sort(byDue),
    });
  };

  for (const uid of speakingOrder) pushOwner(uid);

  const orphans = [...byOwner.keys()].filter((id) => !placed.has(id));
  orphans.sort((a, b) =>
    (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—"),
  );
  for (const uid of orphans) pushOwner(uid);

  if (unassigned.length > 0) {
    groups.push({
      key: "unassigned",
      title: "Unassigned",
      open: unassigned.filter((t) => !t.completed).sort(byDue),
      done: unassigned.filter((t) => t.completed).sort(byDue),
    });
  }

  return groups;
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

  const visibleMilestones = (
    ownerFilter === "all"
      ? allMilestones
      : allMilestones.filter((m) => m.owner_id === ownerFilter)
  ).sort(byDue);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  // Active: owner cards (open + done-this-week). Archived: flat list only —
  // owner cards with "0 · N done" + a DONE strip are noise when everything is
  // already done/archived (and the open count is always 0).
  const groups = showArchived
    ? []
    : groupTodosByOwner(todos, members, speakingOrder);
  const openCount = groups.reduce((n, g) => n + g.open.length, 0);
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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.15fr)] lg:items-start">
          <BoardColumn title="To-Dos" count={openCount}>
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
                <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold">
                    {initials(g.title) || "?"}
                  </span>
                  <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
                    {g.title}
                  </h3>
                  <span className="text-xs text-zinc-500">
                    {g.open.length}
                    {g.done.length > 0 ? ` · ${g.done.length} done` : ""}
                  </span>
                </div>
                {g.open.map((t) => (
                  <TodoListRow
                    key={t.id}
                    teamId={tid}
                    todo={t}
                    ownerName={g.title}
                    members={members}
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
                      />
                    ))}
                  </>
                )}
              </div>
            ))}
          </BoardColumn>

          <BoardColumn title="Milestones" count={visibleMilestones.length}>
            {visibleMilestones.length === 0 ? (
              <EmptyState
                icon={Flag}
                title="No open milestones"
                hint="Rock milestones show here while their parent rock is still active."
              />
            ) : (
              visibleMilestones.map((m) => (
                <MilestoneTodoRow
                  key={m.id}
                  teamId={tid}
                  milestone={m}
                  ownerName={ownerName(m.owner_id)}
                />
              ))
            )}
          </BoardColumn>
        </div>
      )}
    </div>
  );
}

function BoardColumn({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
        {title}{" "}
        <span className="font-bold text-zinc-400">({count})</span>
      </h2>
      <div
        className={cn(
          "max-h-[min(70vh,40rem)] overflow-y-auto rounded-xl border border-zinc-300 bg-white divide-y divide-zinc-100 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900",
        )}
      >
        {children}
      </div>
    </section>
  );
}


