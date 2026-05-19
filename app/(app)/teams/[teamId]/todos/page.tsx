import { requireTeamAccess, getTeamMembers } from "@/lib/teams";
import { TodoRow } from "./todo-row";
import { addTodo, updateTodoTitle } from "./actions";

export default async function TodosPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { user, supabase, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const { data: todos } = await supabase
    .from("todos")
    .select(
      "id, title, owner_id, due_date, completed_at, visibility, created_at",
    )
    .eq("team_id", teamId)
    .or(`visibility.eq.team,owner_id.eq.${user.id}`)
    .order("completed_at", { ascending: true, nullsFirst: true })
    .order("due_date", { ascending: true, nullsFirst: false });

  const open = (todos ?? []).filter((t) => !t.completed_at);
  const done = (todos ?? []).filter((t) => t.completed_at);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">To-Dos</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{team.name}</p>
      </header>

      <Section title={`Open (${open.length})`}>
        {open.length === 0 && <Empty>Nothing open. </Empty>}
        {open.map((t) => (
          <TodoRow
            key={t.id}
            teamId={teamId}
            todo={t}
            ownerName={ownerName(t.owner_id)}
            onRename={updateTodoTitle.bind(null, teamId, t.id)}
          />
        ))}
      </Section>

      {done.length > 0 && (
        <Section title={`Done (${done.length})`}>
          {done.map((t) => (
            <TodoRow
              key={t.id}
              teamId={teamId}
              todo={t}
              ownerName={ownerName(t.owner_id)}
              onRename={updateTodoTitle.bind(null, teamId, t.id)}
            />
          ))}
        </Section>
      )}

      <AddTodoForm teamId={teamId} members={members} currentUserId={user.id} />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
        {title}
      </h2>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>;
}

function AddTodoForm({
  teamId,
  members,
  currentUserId,
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
  currentUserId: string;
}) {
  async function action(formData: FormData) {
    "use server";
    await addTodo(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="What needs to get done?"
        required
        className="md:col-span-3 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <select
        name="owner_id"
        defaultValue={currentUserId}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="">— owner —</option>
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
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Add to-do
      </button>
    </form>
  );
}
