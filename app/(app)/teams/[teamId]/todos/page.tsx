import Link from "next/link";
import { Archive, CheckSquare, Flag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { formatDateOnly, isDueWithinDays } from "@/lib/dates";
import { initials } from "@/lib/initials";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { AddTodoModal } from "./add-todo-modal";
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

type MilestoneDueSoon = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  rock_title: string;
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
  searchParams: Promise<{ archived?: string }>;
}) {
  const { teamId: tid } = await params;
  const { archived: archivedParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);
  const speakingOrder = reconcileSpeakingOrder(team.speakingOrder, members);

  const [snap, rocksSnap] = await Promise.all([
    db.collection("todos").where("team_id", "==", tid).get(),
    db.collection("rocks").where("team_id", "==", tid).get(),
  ]);

  const rockTitleById = new Map(
    rocksSnap.docs.map((d) => [d.id, String(d.data().title ?? "Rock")]),
  );

  // Project plain fields — completed_at is a Timestamp and can't cross the
  // RSC boundary into the client list row.
  const allTodos: TodoListItem[] = [];
  // Milestones due within 7 days (or overdue) surface here so they don't
  // live only under Rocks — Jenna reported a due-today milestone never
  // appeared on To-Dos (P0-4 / P14-4).
  const dueSoonMilestones: MilestoneDueSoon[] = [];
  for (const d of snap.docs) {
    const t = d.data() as TodoDoc;
    if (t.source_rock_id) {
      if (
        !showArchived &&
        !t.completed_at &&
        isDueWithinDays(t.due_date, 7)
      ) {
        dueSoonMilestones.push({
          id: d.id,
          title: t.title,
          owner_id: t.owner_id ?? null,
          due_date: t.due_date ?? null,
          rock_title: rockTitleById.get(t.source_rock_id) ?? "Rock",
        });
      }
      continue;
    }
    const visibility = t.visibility === "private" ? "private" : "team";
    // Private items only for the owner.
    if (visibility === "private" && t.owner_id !== uid) continue;
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

  const activeTodos = allTodos.filter((t) => !t.archived);
  const archivedTodos = allTodos.filter((t) => t.archived);
  const todos = showArchived ? archivedTodos : activeTodos;

  dueSoonMilestones.sort(byDue);

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">To-Dos</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {showArchived
              ? "Items closed in an L10 land here when that meeting ends; other completed items after the Monday cleanup. Restore anytime."
              : "Check off work anytime — no strikethrough. Closed during an L10 archives when that meeting ends; otherwise done items stay until Monday morning cleanup."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-sm">
            <Link
              href={`/teams/${tid}/todos`}
              className={
                !showArchived
                  ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }
            >
              Active ({activeTodos.length})
            </Link>
            <Link
              href={`/teams/${tid}/todos?archived=1`}
              className={
                showArchived
                  ? "inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }
            >
              <Archive className="h-3.5 w-3.5" />
              Archived ({archivedTodos.length})
            </Link>
          </div>
          {!showArchived && (
            <AddTodoModal
              teamId={tid}
              members={members}
              defaultOwnerId={uid}
            />
          )}
        </div>
      </header>

      {!showArchived && dueSoonMilestones.length > 0 && (
        <section>
          <SectionHeader>
            Due soon · milestones ({dueSoonMilestones.length})
          </SectionHeader>
          <List>
            {dueSoonMilestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <Flag
                  className="h-4 w-4 shrink-0 text-zinc-500"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="truncate text-xs text-zinc-500">
                    Milestone · {m.rock_title}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
                  {ownerName(m.owner_id)}
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  {m.due_date ? formatDateOnly(m.due_date) : "—"}
                </span>
              </div>
            ))}
          </List>
          <p className="mt-1.5 text-xs text-zinc-500">
            Check off milestones on the Rocks tab. Shown here when due within 7
            days.
          </p>
        </section>
      )}

      {showArchived ? (
        archivedFlat.length === 0 ? (
          <List>
            <EmptyState
              icon={Archive}
              title="No archived to-dos"
              hint="Completed to-dos archive when an L10 ends, or archive them manually."
            />
          </List>
        ) : (
          <List>
            {archivedFlat.map((t) => (
              <TodoListRow
                key={t.id}
                teamId={tid}
                todo={t}
                ownerName={ownerName(t.owner_id)}
                members={members}
              />
            ))}
          </List>
        )
      ) : (
        <>
          {groups.length === 0 && (
            <List>
              <EmptyState
                icon={CheckSquare}
                title="No to-dos yet"
                hint="Add a to-do, or capture one during the Level 10."
              />
            </List>
          )}

          {openCount === 0 && groups.some((g) => g.done.length > 0) && (
            <p className="text-center text-sm text-hpb-green">
              All to-dos done — they archive when the L10 ends.
            </p>
          )}

          {/* One card per owner — same blocking as L10 To-Dos / Rocks. */}
          {groups.map((g) => (
            <section
              key={g.key}
              className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <header className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold">
                  {initials(g.title) || "?"}
                </span>
                <h2 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
                  {g.title}
                </h2>
                <span className="text-xs text-zinc-500">
                  {g.open.length}
                  {g.done.length > 0 ? ` · ${g.done.length} done` : ""}
                </span>
              </header>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {g.open.length === 0 && g.done.length === 0 && (
                  <div className="px-4 py-3 text-sm text-zinc-500">No to-dos</div>
                )}
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
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
      {children}
    </h2>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  );
}


