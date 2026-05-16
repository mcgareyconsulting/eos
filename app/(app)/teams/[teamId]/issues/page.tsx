import { requireTeamAccess, getTeamMembers } from "@/lib/teams";
import { addIssue, deleteIssue, reopenIssue } from "./actions";
import { PrioritySelect } from "./priority-select";
import { VoteButton } from "./vote-button";
import { SolveButton } from "./solve-button";

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { user, supabase, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const { data: issues } = await supabase
    .from("issues")
    .select(
      "id, title, description, owner_id, priority, votes, type, status, resolved_at, resolution_todo_id, created_at",
    )
    .eq("team_id", teamId)
    .order("status", { ascending: true })
    .order("priority", { ascending: false })
    .order("votes", { ascending: false })
    .order("created_at", { ascending: true });

  const open = (issues ?? []).filter((i) => i.status !== "solved");
  const solved = (issues ?? []).filter((i) => i.status === "solved");

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="mt-1 text-sm text-zinc-500">{team.name}</p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 mb-2">
          Open ({open.length})
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
          {open.length === 0 && (
            <div className="px-4 py-6 text-sm text-zinc-500">
              Nothing open. Add an issue below.
            </div>
          )}
          {open.map((i) => (
            <IssueRow
              key={i.id}
              teamId={teamId}
              issue={i}
              ownerName={ownerName(i.owner_id)}
              members={members}
              currentUserId={user.id}
            />
          ))}
        </div>
      </section>

      {solved.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 mb-2">
            Solved ({solved.length})
          </h2>
          <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
            {solved.map((i) => (
              <SolvedRow
                key={i.id}
                teamId={teamId}
                issue={i}
                ownerName={ownerName(i.owner_id)}
              />
            ))}
          </div>
        </section>
      )}

      <AddIssueForm teamId={teamId} members={members} />
    </div>
  );
}

function IssueRow({
  teamId,
  issue,
  ownerName,
  members,
  currentUserId,
}: {
  teamId: string;
  issue: {
    id: string;
    title: string;
    description: string | null;
    owner_id: string | null;
    priority: number;
    votes: number;
    type: string;
  };
  ownerName: string;
  members: { user_id: string; full_name: string }[];
  currentUserId: string;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 px-4 py-3 items-start text-sm">
      <div className="col-span-6">
        <div className="font-medium">{issue.title}</div>
        {issue.description && (
          <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
            {issue.description}
          </div>
        )}
        <div className="text-xs text-zinc-400 mt-0.5">
          {issue.type === "long" ? "Long-term" : "Short-term"}
        </div>
      </div>
      <div className="col-span-2 text-zinc-600">{ownerName}</div>
      <div className="col-span-1">
        <PrioritySelect
          teamId={teamId}
          issueId={issue.id}
          priority={issue.priority}
        />
      </div>
      <div className="col-span-1">
        <VoteButton teamId={teamId} issueId={issue.id} votes={issue.votes} />
      </div>
      <div className="col-span-2 justify-self-end">
        <SolveButton
          teamId={teamId}
          issueId={issue.id}
          defaultTitle={issue.title}
          members={members}
          currentUserId={currentUserId}
        />
      </div>
    </div>
  );
}

function SolvedRow({
  teamId,
  issue,
  ownerName,
}: {
  teamId: string;
  issue: {
    id: string;
    title: string;
    resolved_at: string | null;
  };
  ownerName: string;
}) {
  async function reopen() {
    "use server";
    await reopenIssue(teamId, issue.id);
  }
  async function remove() {
    "use server";
    await deleteIssue(teamId, issue.id);
  }
  return (
    <div className="grid grid-cols-12 gap-3 px-4 py-2.5 items-center text-sm">
      <div className="col-span-7 text-zinc-500 line-through truncate">
        {issue.title}
      </div>
      <div className="col-span-2 text-xs text-zinc-500">{ownerName}</div>
      <div className="col-span-1 text-xs text-zinc-400">
        {issue.resolved_at
          ? new Date(issue.resolved_at).toLocaleDateString()
          : "—"}
      </div>
      <div className="col-span-2 justify-self-end flex gap-3">
        <form action={reopen}>
          <button
            type="submit"
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            Reopen
          </button>
        </form>
        <form action={remove}>
          <button
            type="submit"
            className="text-xs text-zinc-400 hover:text-red-600"
          >
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}

function AddIssueForm({
  teamId,
  members,
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
}) {
  async function action(formData: FormData) {
    "use server";
    await addIssue(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-200 bg-white p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Issue title"
        required
        className="md:col-span-3 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <select
        name="owner_id"
        defaultValue=""
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">— owner —</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
      </select>
      <select
        name="priority"
        defaultValue="3"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            P{n}
          </option>
        ))}
      </select>
      <select
        name="type"
        defaultValue="short"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="short">Short-term</option>
        <option value="long">Long-term</option>
      </select>
      <textarea
        name="description"
        placeholder="Notes (optional)"
        rows={2}
        className="md:col-span-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Add issue
      </button>
    </form>
  );
}
