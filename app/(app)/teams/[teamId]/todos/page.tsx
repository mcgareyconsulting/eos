import { Trash2, Lock, CheckSquare } from "lucide-react";
import { formatDateOnly } from "@/lib/dates";
import { EmptyState } from "@/components/empty-state";
import { EditableText } from "@/components/editable-text";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { TodoCheckbox } from "./todo-row";
import { AddTodoSubmit } from "./todo-submit-button";
import { addTodo, deleteTodo, updateTodoTitle, updateTodoDescription } from "./actions";

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

export default async function TodosPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const snap = await db.collection("todos").where("team_id", "==", tid).get();

  const todos = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as TodoDoc) }))
    // Milestones live in this collection but belong to a rock — hide them here.
    .filter((t) => !t.source_rock_id)
    // private items hidden from non-owners
    .filter(
      (t) =>
        t.visibility === "team" ||
        t.owner_id === uid,
    );

  const byDue = <T extends { due_date: string | null }>(a: T, b: T) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  };
  const open = todos.filter((t) => !t.completed_at).sort(byDue);
  const done = todos.filter((t) => t.completed_at).sort(byDue);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">To-Dos</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.name} · 7-day action items from L10
        </p>
      </header>

      <AddTodoForm teamId={tid} members={members} defaultOwnerId={uid} />

      <section>
        <SectionHeader>Open ({open.length})</SectionHeader>
        <List>
          {open.length === 0 && <Empty>No open to-dos.</Empty>}
          {open.map((t) => (
            <Row
              key={t.id}
              teamId={tid}
              todo={t}
              ownerName={ownerName(t.owner_id)}
            />
          ))}
        </List>
      </section>

      {done.length > 0 && (
        <section>
          <SectionHeader>Done ({done.length})</SectionHeader>
          <List>
            {done.map((t) => (
              <Row
                key={t.id}
                teamId={tid}
                todo={t}
                ownerName={ownerName(t.owner_id)}
              />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}

function Row({
  teamId,
  todo,
  ownerName,
}: {
  teamId: string;
  todo: { id: string } & TodoDoc;
  ownerName: string;
}) {
  const renameTitle = updateTodoTitle.bind(null, teamId, todo.id);
  const updateDesc = updateTodoDescription.bind(null, teamId, todo.id);
  const remove = deleteTodo.bind(null, teamId, todo.id);
  const completed = !!todo.completed_at;
  return (
    <div className="group grid grid-cols-12 gap-3 px-4 py-3 text-sm">
      <div className="col-span-1 flex items-start pt-0.5">
        <TodoCheckbox teamId={teamId} todoId={todo.id} completed={completed} />
      </div>
      <div className="col-span-7 min-w-0">
        <div>
          <EditableText
            value={todo.title}
            onSave={renameTitle}
            className={completed ? "text-zinc-500 line-through" : ""}
          />
          {todo.visibility === "private" && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-zinc-500">
              <Lock className="h-3 w-3" /> private
            </span>
          )}
        </div>
        {todo.description && (
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            <EditableText
              value={todo.description}
              onSave={updateDesc}
              placeholder="Add description..."
              multiline={true}
            />
          </div>
        )}
      </div>
      <div className="col-span-2 text-zinc-600 dark:text-zinc-400">
        {ownerName}
      </div>
      <div className="col-span-1 text-xs text-zinc-600 dark:text-zinc-400">
        {todo.due_date
          ? formatDateOnly(todo.due_date)
          : "—"}
      </div>
      <div className="col-span-1 justify-self-end">
        <form action={remove}>
          <button
            type="submit"
            className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
            aria-label="Delete to-do"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400 mb-3">
      {children}
    </h2>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
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
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
  defaultOwnerId: string;
}) {
  async function action(formData: FormData) {
    "use server";
    await addTodo(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="To-Do (one line)"
        required
        className="md:col-span-3 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <select
        name="owner_id"
        defaultValue={defaultOwnerId}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
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
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      />
      <select
        name="visibility"
        defaultValue="team"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="team">Team</option>
        <option value="private">Private</option>
      </select>
      <textarea
        name="description"
        placeholder="Add notes or context (optional)"
        rows={2}
        className="md:col-span-6 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm resize-none"
      />
      <AddTodoSubmit />
    </form>
  );
}
