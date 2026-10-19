import { Archive, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { ExportControl } from "@/components/export/export-control";
import { teamListExportParams } from "@/lib/export/urls";
import {
  requireTeamAccess,
  getTeamMembers,
  getOrgTeams,
  type TeamMember,
} from "@/lib/firebase/teams";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import {
  loadAssignedRocks,
  loadMilestonesForRocks,
  loadTeamRocks,
  loadUsersById,
} from "@/lib/firebase/queries";
import { currentQuarter, endOfQuarter, toDateString } from "@/lib/dates";
import { chunkForInQuery } from "@/lib/firestore-in";
import { ownerLabel, userDisplayName } from "@/lib/user-name";
import {
  blockMilestones,
  groupSharedRocksByOwner,
  partitionSharedRocks,
} from "@/lib/rocks-share";
import {
  isAudienceTeam,
  isPrivateRock,
  rockAccess,
  rockSubjectOf,
  type RockHeadline,
} from "@/lib/access/rock";
import {
  buildRockSections,
  mapFullRock,
  sortRocks,
  type FullRock,
} from "@/lib/rocks-view";
import { viewerOf } from "@/lib/access/types";
import { NewRockButton } from "./rock-modal";
import { RockBlockRow, RockRow } from "./rock-row";
import type { MilestoneSerialized } from "./milestone-checklist";
import type { StatusUpdateSerialized } from "./status-history";
import { type TodoDoc } from "@/lib/firestore-types";

// Plain data for the client: TodoDoc.completed_at is a Firestore
// Timestamp, which can't cross the Server → Client component boundary.
function serializeMilestone(id: string, t: TodoDoc): MilestoneSerialized {
  return {
    id,
    title: t.title,
    owner_id: t.owner_id,
    due_date: t.due_date,
    completed: !!t.completed_at,
    description: t.description ?? null,
  };
}

/** A member's block entry (spec §4): a rock headline + their milestones. */
type BlockEntry = {
  id: string;
  team_id: string;
  /** The block's member — what section grouping reads. */
  owner_id: string;
  status: "";
  quarter: "";
  due_date: null;
  rock_type: null;
  is_company_rock: false;
  __block: {
    rowKey: string;
    headline: RockHeadline;
    milestones: MilestoneSerialized[];
  };
};

type Entry = FullRock | BlockEntry;

export default async function RocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ owner?: string; archived?: string }>;
}) {
  const { teamId } = await params;
  const { owner: ownerParam, archived: archivedParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db, team, isAdmin } = await requireTeamAccess(teamId);
  // Company flag is org-admin only — the claim, not team role.
  const canFlagCompany = isAdmin;
  const [orgTeams, members, { membershipTeamIds, leaderTeamIds }] =
    await Promise.all([getOrgTeams(), getTeamMembers(teamId), getUserTeamsFirebase()]);
  // Access follows the viewer's memberships, not the team being viewed
  // (lib/access/rock.ts).
  const viewer = viewerOf(uid, isAdmin, membershipTeamIds, leaderTeamIds);
  const rosterIds = new Set(members.map((m) => m.user_id));
  const shareTeamsExcluding = (parentId: string) =>
    orgTeams
      .filter((t) => t.id !== parentId)
      .map((t) => ({ id: t.id, name: t.name }));
  const shareTeams = shareTeamsExcluding(teamId);
  const teamNameById = new Map(orgTeams.map((t) => [t.id, t.name]));

  const quarter = currentQuarter();
  const eoq = toDateString(endOfQuarter());

  // Fetch rocks, todos (milestones), and status history in parallel.
  const [teamRocks, todosSnap, statusSnap] = await Promise.all([
    loadTeamRocks(db, teamId),
    db.collection("todos").where("team_id", "==", teamId).get(),
    db
      .collection("rock_status_updates")
      .where("team_id", "==", teamId)
      .get(),
  ]);

  // Project plain fields only — spreading d.data() would pull created_at
  // (Firestore Timestamp) across the RSC boundary into RockDetailTrigger.
  const allRocksRaw = teamRocks.own.map((d) => mapFullRock(d.id, d.data()));
  // Active/Archived tabs; rocks only move to Archived by hand (the row's
  // Archive control) — Done rocks stay on Active through the quarter.
  const activeRockCount = allRocksRaw.filter((r) => r.archived_at == null)
    .length;
  const archivedRockCount = allRocksRaw.filter((r) => r.archived_at != null)
    .length;
  const allRocks = allRocksRaw.filter((r) =>
    showArchived ? r.archived_at != null : r.archived_at == null,
  );

  // Rocks with this team in their audience: the full rock, Active list only
  // — they archive on the parent team, not here. Owner on this roster →
  // their own section (with a "from {team}" chip); otherwise → "Shared by
  // {owner}" at the bottom.
  const sharedRocksRaw = teamRocks.shared
    .map((d) => mapFullRock(d.id, d.data()))
    .filter((r) => isAudienceTeam(r, teamId) && r.archived_at == null);
  const { ownerOnRoster: sharedIntoSections, sharedBy: sharedRocksBelow } =
    partitionSharedRocks(sharedRocksRaw, rosterIds);

  // The audience edits a rock against its PARENT team (the owner must be on
  // that roster), so the modal needs the parent's people.
  const parentRosters = new Map<string, TeamMember[]>(
    await Promise.all(
      [...new Set(sharedRocksRaw.map((r) => r.team_id))].map(
        async (id) => [id, await getTeamMembers(id)] as const,
      ),
    ),
  );

  const milestonesByRock = new Map<string, MilestoneSerialized[]>();
  function addMilestone(id: string, t: TodoDoc) {
    if (!t.source_rock_id) return;
    const m = serializeMilestone(id, t);
    const list = milestonesByRock.get(t.source_rock_id) ?? [];
    list.push(m);
    milestonesByRock.set(t.source_rock_id, list);
  }

  for (const d of todosSnap.docs) addMilestone(d.id, d.data() as TodoDoc);
  const statusByRock = new Map<string, StatusUpdateSerialized[]>();
  function addStatus(d: FirebaseFirestore.QueryDocumentSnapshot) {
    const x = d.data();
    const rockId = x.rock_id as string | undefined;
    if (!rockId) return;
    const created = x.created_at as { toMillis?: () => number } | null;
    const list = statusByRock.get(rockId) ?? [];
    list.push({
      id: d.id,
      status: String(x.status ?? ""),
      comment: (x.comment as string | null) ?? null,
      user_id: (x.user_id as string | null) ?? null,
      created_at_ms: created?.toMillis?.() ?? null,
      author_name: "—",
    });
    statusByRock.set(rockId, list);
  }
  for (const d of statusSnap.docs) addStatus(d);

  const sharedRockIds = sharedRocksRaw.map((r) => r.id);
  if (sharedRockIds.length > 0) {
    const [extraMilestones, extraStatusSnaps] = await Promise.all([
      loadMilestonesForRocks(db, sharedRockIds),
      Promise.all(
        chunkForInQuery(sharedRockIds).map((ids) =>
          db.collection("rock_status_updates").where("rock_id", "in", ids).get(),
        ),
      ),
    ]);
    for (const d of extraMilestones) addMilestone(d.id, d.data() as TodoDoc);
    for (const snap of extraStatusSnaps) for (const d of snap.docs) addStatus(d);
  }

  const byDue = (a: { due_date: string | null }, b: { due_date: string | null }) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  };
  for (const list of milestonesByRock.values()) list.sort(byDue);
  for (const list of statusByRock.values()) {
    list.sort((a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0));
  }

  // Blocks (spec §4): each member's milestones on other teams' non-private
  // rocks — the rock's headline and the milestone, nothing else. Read-only;
  // only the assignee ticks. Active list only.
  const blockEntries: BlockEntry[] = [];
  if (!showArchived) {
    const assigned = await loadAssignedRocks(
      db,
      [...rosterIds],
      new Set(teamRocks.own.map((d) => d.id)),
    );
    const msByRock = new Map<string, { id: string; t: TodoDoc }[]>();
    for (const d of assigned.milestones) {
      const t = d.data() as TodoDoc;
      if (!t.source_rock_id) continue;
      const list = msByRock.get(t.source_rock_id) ?? [];
      list.push({ id: d.id, t });
      msByRock.set(t.source_rock_id, list);
    }
    for (const d of assigned.rocks) {
      const x = d.data() ?? {};
      const subject = rockSubjectOf(x);
      if (isPrivateRock(subject)) continue;
      const headline: RockHeadline = {
        id: d.id,
        title: String(x.title ?? "Rock"),
        owner_id: subject.owner_id,
        team_id: subject.team_id,
      };
      const ms = (msByRock.get(d.id) ?? []).map(({ id, t }) => ({ ...t, id }));
      for (const [carrierId, list] of blockMilestones(subject, teamId, rosterIds, ms)) {
        blockEntries.push({
          id: d.id,
          team_id: subject.team_id,
          owner_id: carrierId,
          status: "",
          quarter: "",
          due_date: null,
          rock_type: null,
          is_company_rock: false,
          __block: {
            rowKey: `${d.id}:${carrierId}`,
            headline,
            milestones: list.map((m) => serializeMilestone(m.id, m)).sort(byDue),
          },
        });
      }
    }
  }

  const extraNameIds = [
    ...sharedRocksRaw.map((r) => r.owner_id),
    ...blockEntries.map((b) => b.__block.headline.owner_id),
    ...[...milestonesByRock.values()].flatMap((list) =>
      list.map((m) => m.owner_id),
    ),
    ...[...statusByRock.values()].flatMap((list) =>
      list.map((e) => e.user_id),
    ),
  ].filter((id): id is string => !!id && !rosterIds.has(id));
  const extraNameById = new Map<string, string>();
  for (const [id, data] of await loadUsersById(db, extraNameIds)) {
    const name = userDisplayName(data);
    if (name) extraNameById.set(id, name);
  }

  // Filter: "all" or a member user_id. Legacy values from the retired
  // Team/Self/Others filter still arrive via old bookmarks — self/mine map to
  // the signed-in user, anything else unknown falls back to "all".
  const filterRaw = ownerParam || "all";
  const legacyMapped =
    filterRaw === "self" || filterRaw === "mine"
      ? uid
      : filterRaw === "team" || filterRaw === "others"
        ? "all"
        : filterRaw;
  const filter = rosterIds.has(legacyMapped) ? legacyMapped : "all";

  const ownerName = (id: string | null) =>
    ownerLabel(
      id,
      (x) =>
        members.find((m) => m.user_id === x)?.full_name ?? extraNameById.get(x),
    );

  // Carry every milestone owner's name on the row. Rows resolve names from
  // the roster they are handed, and an audience rock renders with its
  // PARENT roster, so a milestone owned by someone on this team would
  // otherwise read "—".
  for (const list of [
    ...milestonesByRock.values(),
    ...blockEntries.map((b) => b.__block.milestones),
  ]) {
    for (const m of list) {
      if (m.owner_id) m.owner_label = ownerName(m.owner_id);
    }
  }
  for (const list of statusByRock.values()) {
    for (const e of list) {
      if (e.user_id) e.author_name = ownerName(e.user_id);
    }
  }

  // Sections: lib/rocks-view.ts buildRockSections (shared with the export).
  const sections = buildRockSections<Entry>(
    showArchived
      ? allRocks
      : [...allRocks, ...sharedIntoSections, ...blockEntries],
    { teamId, filter, members, ownerName },
  );

  const sharedForView = showArchived
    ? []
    : filter === "all"
      ? sharedRocksBelow
      : sharedRocksBelow.filter((r) => r.owner_id === filter);
  const sharedGroups = groupSharedRocksByOwner(sharedForView, ownerName).map(
    (g) => ({ ...g, rocks: sortRocks(g.rocks) as Entry[] }),
  );

  const emptyMessage = showArchived
    ? "No archived rocks yet."
    : filter === "all"
      ? "No rocks yet."
      : `No rocks for ${ownerName(filter)}.`;

  const ownerFilter =
    filter !== "all" && filter !== "team" ? filter : undefined;

  // Per-row wiring. Everyone who sees a full rock here may edit it (the
  // parent team, or this team as its audience). Rock actions run against
  // the rock's PARENT team (`teamId`, the parent roster for the owner
  // picker); ticks and the thread run from this page's team (`viewTeamId`).
  // Delete stays with the parent team; audience and Private with its
  // leaders (lib/access/rock.ts).
  function rowProps(r: FullRock) {
    const own = r.team_id === teamId;
    const fromTeamName = own
      ? undefined
      : (teamNameById.get(r.team_id) ?? "another team");
    return {
      teamId: r.team_id,
      viewTeamId: teamId,
      members: own ? members : (parentRosters.get(r.team_id) ?? members),
      teamName: own ? team.name : fromTeamName,
      shareTeams: own ? shareTeams : shareTeamsExcluding(r.team_id),
      canFlagCompany,
      canEdit: rockAccess.canEdit(r, viewer),
      canDelete: rockAccess.canDelete(r, viewer),
      canManageAudience: rockAccess.canChangeAudience(r, viewer),
      fromTeamName,
    };
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title="Rocks"
        leading={
          // Export of exactly this view for whoever is looking, milestones
          // included (docs/EXPORT.md). The server re-checks team access.
          <ExportControl
            exportId="rocks"
            params={teamListExportParams({ teamId, showArchived, ownerFilter: filter })}
          />
        }
        filter={<OwnerFilter members={members} currentUserId={uid} />}
        tabs={
          <EntityViewTabs
            basePath={`/teams/${teamId}/rocks`}
            showArchived={showArchived}
            activeCount={activeRockCount}
            archivedCount={archivedRockCount}
            owner={ownerFilter}
          />
        }
        add={
          <NewRockButton
            teamId={teamId}
            members={members}
            quarter={quarter}
            defaultDue={eoq}
            currentUserId={uid}
            teamName={team.name}
            shareTeams={shareTeams}
            canFlagCompany={canFlagCompany}
            canManageAudience={rockAccess.canChangeAudience(
              { team_id: teamId, owner_id: null },
              viewer,
            )}
          />
        }
      />

      {sections.length === 0 && sharedGroups.length === 0 ? (
        <RockSection title={showArchived ? "Archived" : "Rocks"}>
          {showArchived ? (
            <EmptyState
              icon={Archive}
              title="No archived rocks"
              hint="Nothing archived yet. Rocks you archive from the Active list land here."
            />
          ) : (
            <Empty>{emptyMessage}</Empty>
          )}
        </RockSection>
      ) : (
        <>
          {[
            ...sections,
            ...sharedGroups.map((g) => ({
              key: `shared-${g.ownerId ?? "none"}`,
              title: g.title,
              rocks: g.rocks,
            })),
          ].map((g) => (
            <RockSection key={g.key} title={g.title} count={g.rocks.length}>
              {g.rocks.map((r) => {
                if ("__block" in r) {
                  const b = r.__block;
                  return (
                    <RockBlockRow
                      key={b.rowKey}
                      viewTeamId={teamId}
                      headline={b.headline}
                      ownerName={ownerName(b.headline.owner_id)}
                      fromTeamName={
                        teamNameById.get(b.headline.team_id) ?? "another team"
                      }
                      milestones={b.milestones}
                      currentUserId={uid}
                    />
                  );
                }
                return (
                  <RockRow
                    key={r.id}
                    {...rowProps(r)}
                    userId={uid}
                    rock={r}
                    ownerName={ownerName(r.owner_id)}
                    milestones={milestonesByRock.get(r.id) ?? []}
                    defaultDue={eoq}
                    statusHistory={statusByRock.get(r.id) ?? []}
                    currentUserId={uid}
                  />
                );
              })}
            </RockSection>
          ))}
        </>
      )}
    </div>
  );
}

function RockSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
        {title}
        {count != null ? (
          <span className="font-bold text-zinc-400"> ({count})</span>
        ) : null}
      </h2>
      <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState icon={Target} title={children} />;
}
