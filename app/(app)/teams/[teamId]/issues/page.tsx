import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { addIssue } from "./actions";
import { IssuesList, type IssueDoc } from "./issues-list";

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  // Server-rendered hydration only — IssuesList re-subscribes client-side.
  // Voting lives in the L10 Issues segment; this tab is capture/triage only.
  const issuesSnap = await db
    .collection("issues")
    .where("team_id", "==", tid)
    .get();

  // Project explicitly rather than spreading the raw doc: issues carry a
  // created_at Timestamp that is not serializable across the server/client
  // boundary and would crash the render.
  const initialIssues: IssueDoc[] = issuesSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      team_id: x.team_id,
      title: x.title,
      description: x.description ?? null,
      owner_id: x.owner_id ?? null,
      priority: x.priority ?? null,
      votes: x.votes ?? 0,
      type: x.type,
      status: x.status,
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.name} · capture & triage here · vote during the L10 Issues
          segment
        </p>
      </header>

      <AddIssueForm teamId={tid} members={members} defaultOwnerId={uid} />

      <IssuesList
        teamId={tid}
        members={members}
        initialIssues={initialIssues}
      />
    </div>
  );
}

function AddIssueForm({
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
    await addIssue(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Issue (one line)"
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
      <select
        name="priority"
        defaultValue=""
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="">No priority</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select
        name="type"
        defaultValue="short"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="short">Short-term</option>
        <option value="long">Long-term</option>
      </select>
      <textarea
        name="description"
        placeholder="Detail (optional)"
        rows={2}
        className="md:col-span-6 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Add issue
      </button>
    </form>
  );
}
