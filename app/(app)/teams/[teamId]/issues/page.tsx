import { Trash2 } from "lucide-react";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { VoteButton } from "./vote-button";
import { StatusActions } from "./status-actions";
import { addIssue, deleteIssue } from "./actions";

type IssueDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: number;
  votes: number;
  type: "short" | "long";
  status: "open" | "solving" | "solved" | "dropped";
};

const STATUS_LABEL: Record<IssueDoc["status"], string> = {
  open: "Open",
  solving: "Solving",
  solved: "Solved",
  dropped: "Dropped",
};

const STATUS_BADGE: Record<IssueDoc["status"], string> = {
  open: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300",
  solving:
    "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300",
  solved:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
  dropped:
    "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const [issuesSnap, votesSnap] = await Promise.all([
    db.collection("issues").where("team_id", "==", tid).get(),
    db
      .collection("issue_votes")
      .where("user_id", "==", uid)
      .where("team_id", "==", tid)
      .get(),
  ]);

  const myVoteByIssue = new Map<string, number>();
  let myVotesUsed = 0;
  for (const d of votesSnap.docs) {
    const data = d.data();
    const c = Number(data.count ?? 1); // back-compat: legacy docs without count
    myVoteByIssue.set(data.issue_id as string, c);
    myVotesUsed += c;
  }
  const myVotesRemaining = Math.max(0, 3 - myVotesUsed);

  const STATUS_ORDER = ["open", "solving", "solved", "dropped"];
  const issues = issuesSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as IssueDoc) }))
    .sort((a, b) => {
      const byStatus =
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (byStatus !== 0) return byStatus;
      // votes desc within status
      return (b.votes ?? 0) - (a.votes ?? 0);
    });

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {team.name} · {myVotesUsed}/3 votes used · IDS during L10
        </p>
      </header>

      <AddIssueForm teamId={tid} />

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {issues.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No issues yet. Add one above.
          </div>
        )}
        {issues.map((i) => {
          const remove = deleteIssue.bind(null, tid, i.id);
          return (
            <div
              key={i.id}
              className="group flex items-start gap-3 px-4 py-3 text-sm"
            >
              <VoteButton
                teamId={tid}
                issueId={i.id}
                count={i.votes ?? 0}
                myCount={myVoteByIssue.get(i.id) ?? 0}
                myRemaining={myVotesRemaining}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[i.status]}`}
                  >
                    {STATUS_LABEL[i.status]}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {i.type === "long" ? "Long-term" : "Short-term"}
                  </span>
                </div>
                <div className="mt-1 font-medium">{i.title}</div>
                {i.description && (
                  <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    {i.description}
                  </div>
                )}
                <div className="mt-1 text-xs text-zinc-500">
                  {ownerName(i.owner_id)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <StatusActions teamId={tid} issueId={i.id} status={i.status} />
                <form action={remove}>
                  <button
                    type="submit"
                    className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
                    aria-label="Delete issue"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddIssueForm({ teamId }: { teamId: string }) {
  async function action(formData: FormData) {
    "use server";
    await addIssue(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Issue (one line)"
        required
        className="md:col-span-4 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <select
        name="type"
        defaultValue="short"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="short">Short-term</option>
        <option value="long">Long-term</option>
      </select>
      <select
        name="priority"
        defaultValue="3"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="1">P1 — urgent</option>
        <option value="2">P2 — high</option>
        <option value="3">P3 — medium</option>
        <option value="4">P4 — low</option>
        <option value="5">P5 — backlog</option>
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
