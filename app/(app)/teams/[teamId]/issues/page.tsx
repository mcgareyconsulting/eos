import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { IssuesList, type IssueDoc } from "./issues-list";

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db } = await requireTeamAccess(tid);
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
      votes: Number(x.votes ?? 0),
      type: x.type,
      status: x.status,
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
      </header>

      <IssuesList
        teamId={tid}
        userId={uid}
        members={members}
        initialIssues={initialIssues}
      />
    </div>
  );
}
