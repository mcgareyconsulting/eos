import { Trash2, AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { StatusActions } from "./status-actions";
import { addIssue, deleteIssue } from "./actions";

type IssueDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
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
    "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const issuesSnap = await db
    .collection("issues")
    .where("team_id", "==", tid)
    .get();

  // Voting happens in the L10 IDS segment; this page is read-only and just
  // ranks issues by the team's vote total (most important first), with
  // active issues above resolved ones.
  const STATUS_ORDER = ["open", "solving", "solved", "dropped"];
  const issues = issuesSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as IssueDoc) }))
    .sort((a, b) => {
      const byStatus =
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (byStatus !== 0) return byStatus;
      return (b.votes ?? 0) - (a.votes ?? 0);
    });

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.name} · ranked by team votes · vote &amp; IDS during L10
        </p>
      </header>

      <AddIssueForm teamId={tid} />

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {issues.length === 0 && (
          <EmptyState
            icon={AlertCircle}
            title="No issues yet"
            hint="Capture team blockers above, then vote and solve them in the L10 IDS segment."
          />
        )}
        {issues.map((i) => {
          const remove = deleteIssue.bind(null, tid, i.id);
          return (
            <div
              key={i.id}
              className="group flex items-start gap-3 px-4 py-3 text-sm"
            >
              <div
                className="flex w-9 shrink-0 flex-col items-center pt-0.5"
                title="Team votes (cast during L10)"
              >
                <span className="text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                  {i.votes ?? 0}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                  votes
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[i.status]}`}
                  >
                    {STATUS_LABEL[i.status]}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {i.type === "long" ? "Long-term" : "Short-term"}
                  </span>
                </div>
                <div className="mt-1 font-medium">{i.title}</div>
                {i.description && (
                  <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    {i.description}
                  </div>
                )}
                <div className="mt-1 text-xs text-zinc-600">
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
      className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Issue (one line)"
        required
        className="md:col-span-5 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
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
