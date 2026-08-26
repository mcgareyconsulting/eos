import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { isArchivedIssue } from "@/lib/issues";
import { IssueFormModal } from "./issue-form-modal";
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
  searchParams: Promise<{ archived?: string; owner?: string }>;
}) {
  const { teamId: tid } = await params;
  const { archived: archivedParam, owner: ownerParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const issuesSnap = await db
    .collection("issues")
    .where("team_id", "==", tid)
    .get();

  const allIssues: IssueDoc[] = issuesSnap.docs.map((d) => {
    const x = d.data();
    const archived = isArchivedIssue(x);
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

  const rosterIds = new Set(members.map((m) => m.user_id));
  const filterRaw = ownerParam || "all";
  const legacyMapped =
    filterRaw === "self" || filterRaw === "mine"
      ? uid
      : filterRaw === "team" || filterRaw === "others"
        ? "all"
        : filterRaw;
  const ownerFilter = rosterIds.has(legacyMapped) ? legacyMapped : "all";

  const activeCount = allIssues.filter((i) => !i.archived).length;
  const archivedCount = allIssues.filter((i) => i.archived).length;
  const initialIssues = showArchived
    ? allIssues.filter((i) => i.archived)
    : allIssues.filter((i) => !i.archived);

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title="Issues"
        filter={<OwnerFilter members={members} currentUserId={uid} />}
        tabs={
          <EntityViewTabs
            basePath={`/teams/${tid}/issues`}
            showArchived={showArchived}
            activeCount={activeCount}
            archivedCount={archivedCount}
            owner={ownerFilter !== "all" ? ownerFilter : undefined}
          />
        }
        add={
          <IssueFormModal
            teamId={tid}
            members={members}
            defaultOwnerId={uid}
          />
        }
      />

      <IssuesList
        teamId={tid}
        userId={uid}
        members={members}
        initialIssues={initialIssues}
        showArchived={showArchived}
        ownerFilter={ownerFilter}
      />
    </div>
  );
}
