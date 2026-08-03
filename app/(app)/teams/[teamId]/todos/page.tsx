import { CheckSquare, Flag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { daysFromNow, formatDateOnly, isDueWithinDays } from "@/lib/dates";
import { AddTodoSubmit } from "./todo-submit-button";
import { addTodo } from "./actions";
import { TodoListRow, type TodoListItem } from "./todo-list-row";

type TodoDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | null;
  visibility: "team" | "private";
  source_issue_id: string | null;
  source_meeting_id: string | null;
  source_rock_id: string | null;
};

type MilestoneDueSoon = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  rock_title: string;
};

export default async function TodosPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const [snap, rocksSnap] = await Promise.all([
    db.collection("todos").where("team_id", "==", tid).get(),
    db.collection("rocks").where("team_id", "==", tid).get(),
  ]);

  const rockTitleById = new Map(
    rocksSnap.docs.map((d) => [d.id, String(d.data().title ?? "Rock")]),
  );

  // Project plain fields — completed_at is a Timestamp and can't cross the
  // RSC boundary into the client list row.
  const todos: TodoListItem[] = [];
  // Milestones due within 7 days (or overdue) surface here so they don't
  // live only under Rocks — Jenna reported a due-today milestone never
  // appeared on To-Dos (P0-4 / P14-4).
  const dueSoonMilestones: MilestoneDueSoon[] = [];
  for (const d of snap.docs) {
    const t = d.data() as TodoDoc;
    if (t.source_rock_id) {
      if (
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
    todos.push({
      id: d.id,
      title: t.title,
      description: t.description ?? null,
      owner_id: t.owner_id ?? null,
      due_date: t.due_date ?? null,
      completed: !!t.completed_at,
      visibility,
    });
  }

  const byDue = <T extends { due_date: string | null }>(a: T, b: T) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  };
  const open = todos.filter((t) => !t.completed).sort(byDue);
  const done = todos.filter((t) => t.completed).sort(byDue);
  dueSoonMilestones.sort(byDue);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  const defaultDue = daysFromNow(7);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">To-Dos</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.name} · click a title to expand · pencil to edit
        </p>
      </header>

      <AddTodoForm
        teamId={tid}
        members={members}
        defaultOwnerId={uid}
        defaultDue={defaultDue}
      />

      {dueSoonMilestones.length > 0 && (
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

      <section>
        <SectionHeader>Open ({open.length})</SectionHeader>
        <List>
          {open.length === 0 && <Empty>No open to-dos.</Empty>}
          {open.map((t) => (
            <TodoListRow
              key={t.id}
              teamId={tid}
              todo={t}
              ownerName={ownerName(t.owner_id)}
              members={members}
            />
          ))}
        </List>
      </section>

      {done.length > 0 && (
        <section>
          <SectionHeader>Done ({done.length})</SectionHeader>
          <List>
            {done.map((t) => (
              <TodoListRow
                key={t.id}
                teamId={tid}
                todo={t}
                ownerName={ownerName(t.owner_id)}
                members={members}
              />
            ))}
          </List>
        </section>
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

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState icon={CheckSquare} title={children} />;
}

function AddTodoForm({
  teamId,
  members,
  defaultOwnerId,
  defaultDue,
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
  defaultOwnerId: string;
  /** YYYY-MM-DD — client expects +7 days (P0-4 / P14-4). */
  defaultDue: string;
}) {
  async function action(formData: FormData) {
    "use server";
    await addTodo(teamId, formData);
  }
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-300 bg-white p-4 md:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        name="title"
        placeholder="To-Do (one line)"
        required
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 md:col-span-3"
      />
      <select
        name="owner_id"
        defaultValue={defaultOwnerId}
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700"
      >
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
      </select>
      <input
        name="due_date"
        type="date"
        defaultValue={defaultDue}
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700"
      />
      <select
        name="visibility"
        defaultValue="team"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700"
      >
        <option value="team">Team</option>
        <option value="private">Private</option>
      </select>
      <textarea
        name="description"
        placeholder="Add notes or context (optional)"
        rows={2}
        className="resize-none rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 md:col-span-6"
      />
      <AddTodoSubmit />
    </form>
  );
}
