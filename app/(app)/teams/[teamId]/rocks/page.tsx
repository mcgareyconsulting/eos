import { Archive, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
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
  audienceTeamIdsOf,
  audienceUserIdsOf,
  isAudienceTeam,
  isPrivateRock,
  rockAccess,
  rockSubjectOf,
  type RockHeadline,
} from "@/lib/access/rock";
import { viewerOf } from "@/lib/access/types";
import { NewRockButton } from "./rock-modal";
import { RockBlockRow, RockRow } from "./rock-row";
import {
  COMPANY_SECTION_TITLE,
  DEPARTMENT_SECTION_TITLE,
  rockBucket,
} from "./rock-type";
import type { MilestoneSerialized } from "./milestone-checklist";
import type { StatusUpdateSerialized } from "./status-history";
import { type TodoDoc } from "@/lib/firestore-types";

const STATUS_ORDER = ["on_track", "off_track", "done", "cancelled"];

// Timestamp | millis | null → millis | null. Unknown-but-set still counts
// as archived (0), matching the != null checks downstream.
function archivedAtMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : 0;
}

// Within a section: status, then quarter (so Q3 / Q4 sit together), then due.
// Block entries carry no status and sort after the section's own rocks.
function sortRocks<
  T extends {
    status: string;
    quarter?: string | null;
    due_date: string | null;
  },
>(rocks: T[]): T[] {
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s);
    return i < 0 ? STATUS_ORDER.length : i;
  };
  return [...rocks].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    const qa = a.quarter ?? "";
    const qb = b.quarter ?? "";
    if (qa !== qb) return qa.localeCompare(qb);
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}

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

/**
 * Plain fields of a full rock. Audience and Private come out as their
 * EFFECTIVE values (lib/access/rock.ts — legacy `shared_team_ids` /
 * `team_only` folded in), so nothing downstream reads the old names.
 */
function mapFullRock(id: string, x: FirebaseFirestore.DocumentData) {
  const subject = rockSubjectOf(x);
  return {
    id,
    team_id: subject.team_id,
    title: x.title as string,
    owner_id: subject.owner_id,
    quarter: x.quarter as string,
    due_date: (x.due_date as string | null) ?? null,
    status: x.status as string,
    description: (x.description as string | null) ?? null,
    rock_type: (x.rock_type as string | null) ?? null,
    is_company_rock: x.is_company_rock === true,
    audience_team_ids: audienceTeamIdsOf(subject),
    audience_user_ids: audienceUserIdsOf(subject),
    private: isPrivateRock(subject),
    assigned_by: (x.assigned_by as string | null) ?? null,
    created_by: (x.created_by as string | null) ?? null,
    follower_ids: Array.isArray(x.follower_ids)
      ? (x.follower_ids as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    // archived_at is a Firestore Timestamp — pass millis, the raw class
    // instance can't cross into the client RockRow.
    archived_at: archivedAtMillis(x.archived_at),
  };
}

type FullRock = ReturnType<typeof mapFullRock>;

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
  // Active/Archived tabs; Monday CF moves Done rocks (completed_at before
  // this week's Monday) onto Archived.
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

  // All view: Company section first, then Department (shared ownership +
  // Team rocks, even when a person is accountable), then members A–Z, then
  // owners no longer on the roster. A rock lands in exactly one section down
  // that ladder (lib/rock-bucket.ts). L10 matches (see segment-rocks.tsx).
  //
  // An audience rock whose owner sits on this roster, and every block
  // entry, skip the ladder and file under that person.
  type RockGroup = { key: string; title: string; rocks: Entry[] };
  const bucketOf = (r: Entry) =>
    r.team_id === teamId ? rockBucket(r) : "owner";

  function buildSections(rocks: Entry[]): RockGroup[] {
    if (filter !== "all") {
      const list = rocks.filter((r) => r.owner_id === filter);
      if (list.length === 0) return [];
      return [
        { key: filter, title: ownerName(filter), rocks: sortRocks(list) },
      ];
    }

    const companyRocks: Entry[] = [];
    const deptRocks: Entry[] = [];
    const byOwner = new Map<string, Entry[]>();
    for (const r of rocks) {
      const bucket = bucketOf(r);
      if (bucket === "company") {
        companyRocks.push(r);
        continue;
      }
      if (bucket === "department") {
        deptRocks.push(r);
        continue;
      }
      const id = r.owner_id as string;
      const list = byOwner.get(id) ?? [];
      list.push(r);
      byOwner.set(id, list);
    }

    const groups: RockGroup[] = [];
    if (companyRocks.length > 0) {
      groups.push({
        key: "company",
        title: COMPANY_SECTION_TITLE,
        rocks: sortRocks(companyRocks),
      });
    }
    if (deptRocks.length > 0) {
      groups.push({
        key: "department",
        title: DEPARTMENT_SECTION_TITLE,
        rocks: sortRocks(deptRocks),
      });
    }

    const named = [...members].sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    );
    for (const m of named) {
      const list = byOwner.get(m.user_id);
      if (!list || list.length === 0) continue;
      groups.push({
        key: m.user_id,
        title: m.full_name,
        rocks: sortRocks(list),
      });
    }

    // Owners not on the current roster (left the team, stale id).
    const orphanIds = [...byOwner.keys()].filter((id) => !rosterIds.has(id));
    orphanIds.sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
    for (const id of orphanIds) {
      groups.push({
        key: id,
        title: ownerName(id),
        rocks: sortRocks(byOwner.get(id)!),
      });
    }

    return groups;
  }

  const sections = buildSections(
    showArchived
      ? allRocks
      : [...allRocks, ...sharedIntoSections, ...blockEntries],
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
              hint="Nothing archived yet. Rocks marked Done before this week’s Monday land here after the overnight sweep."
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
