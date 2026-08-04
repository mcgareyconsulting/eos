import Link from "next/link";
import { Archive } from "lucide-react";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { IssuesList, type IssueDoc } from "./issues-list";

function formatClosedOn(
  archived_at: { toDate?: () => Date; toMillis?: () => number } | null | undefined,
): string | null {
  if (archived_at == null) return null;
  let d: Date | null = null;
  if (typeof archived_at.toDate === "function") d = archived_at.toDate();
  else if (typeof archived_at.toMillis === "function") {
    d = new Date(archived_at.toMillis());
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { teamId: tid } = await params;
  const { archived: archivedParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const issuesSnap = await db
    .collection("issues")
    .where("team_id", "==", tid)
    .get();

  const allIssues: IssueDoc[] = issuesSnap.docs.map((d) => {
    const x = d.data();
    const archived = x.archived_at != null;
    return {
      id: d.id,
      team_id: x.team_id,
      title: x.title,
      description: x.description ?? null,
      owner_id: x.owner_id ?? null,
      priority: x.priority ?? null,
      votes: Number(x.votes ?? 0),
      type: x.type,
      status: x.status,
      archived,
      closed_on: archived ? formatClosedOn(x.archived_at) : null,
    };
  });

  const activeCount = allIssues.filter((i) => !i.archived).length;
  const archivedCount = allIssues.filter((i) => i.archived).length;
  const initialIssues = showArchived
    ? allIssues.filter((i) => i.archived)
    : allIssues.filter((i) => !i.archived);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {showArchived
              ? "Solved or dropped in an L10 archive when that meeting ends; mid-week closes archive Monday morning."
              : "Close in the L10 to archive at Finish. Outside the meeting, closed issues stay gray until Monday cleanup."}
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href={`/teams/${tid}/issues`}
            className={
              !showArchived
                ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            Active ({activeCount})
          </Link>
          <Link
            href={`/teams/${tid}/issues?archived=1`}
            className={
              showArchived
                ? "inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            <Archive className="h-3.5 w-3.5" />
            Archived ({archivedCount})
          </Link>
        </div>
      </header>

      <IssuesList
        teamId={tid}
        userId={uid}
        members={members}
        initialIssues={initialIssues}
        showArchived={showArchived}
      />
    </div>
  );
}
