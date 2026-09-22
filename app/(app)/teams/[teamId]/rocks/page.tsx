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
  groupSharedRocksByOwner,
  isSharedIntoTeam,
  partitionSharedRocks,
  rockAccessFor,
  carriersForViewer,
  hasFullRockView,
  isMilestoneLocked,
  type RockViewer,
} from "@/lib/rocks-share";
import { NewRockButton } from "./rock-modal";
import { RockRow } from "./rock-row";
import {
  COMPANY_SECTION_TITLE,
  DEPARTMENT_SECTION_TITLE,
  rockBucket,
} from "./rock-type";
import type { MilestoneSerialized } from "./milestone-checklist";
import type { StatusUpdateSerialized } from "./status-history";
import {
  type RockDoc,
  type TodoDoc,
  type WithId,
} from "@/lib/firestore-types";

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
// No quarter filter — the list shows every rock on the team.
function sortRocks<
  T extends {
    status: string;
    quarter?: string | null;
    due_date: string | null;
  },
>(rocks: T[]): T[] {
  return [...rocks].sort((a, b) => {
    const byStatus =
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
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
    locked: isMilestoneLocked(t),
  };
}

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
  const [orgTeams, members, { membershipTeamIds }] = await Promise.all([
    getOrgTeams(),
    getTeamMembers(teamId),
    getUserTeamsFirebase(),
  ]);
  // Access to a shared-in rock follows the viewer's memberships, not the
  // team being viewed (lib/rocks-share.ts, parent-team rule).
  const viewer: RockViewer = {
    uid,
    isAdmin,
    teamIds: new Set(membershipTeamIds),
  };
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
  // Status comments live in rock_status_updates (append-only); they were
  // written on save but never rendered until this fetch existed.
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
  const allRocksRaw = teamRocks.own.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      team_id: x.team_id as string,
      title: x.title as string,
      owner_id: (x.owner_id as string | null) ?? null,
      quarter: x.quarter as string,
      due_date: (x.due_date as string | null) ?? null,
      status: x.status as string,
      description: (x.description as string | null) ?? null,
      rock_type: (x.rock_type as string | null) ?? null,
      is_company_rock: x.is_company_rock === true,
      shared_team_ids: (x.shared_team_ids as string[] | null) ?? [],
      team_only: x.team_only === true,
      // archived_at is a Firestore Timestamp — pass millis, the raw class
      // instance can't cross into the client RockRow.
      archived_at: archivedAtMillis(x.archived_at),
    };
  });
  // Active/Archived tabs; Monday CF moves Done rocks (completed_at before
  // this week's Monday) onto Archived.
  const activeRockCount = allRocksRaw.filter((r) => r.archived_at == null)
    .length;
  const archivedRockCount = allRocksRaw.filter((r) => r.archived_at != null)
    .length;
  const allRocks = allRocksRaw.filter((r) =>
    showArchived ? r.archived_at != null : r.archived_at == null,
  );

  const sharedRocksRaw = teamRocks.shared
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id as string,
        title: x.title as string,
        owner_id: (x.owner_id as string | null) ?? null,
        quarter: x.quarter as string,
        due_date: (x.due_date as string | null) ?? null,
        status: x.status as string,
        description: (x.description as string | null) ?? null,
        rock_type: (x.rock_type as string | null) ?? null,
        is_company_rock: x.is_company_rock === true,
        shared_team_ids: (x.shared_team_ids as string[] | null) ?? [],
        team_only: x.team_only === true,
          archived_at: archivedAtMillis(x.archived_at),
      };
    })
    .filter((r) => isSharedIntoTeam(r, teamId) && r.archived_at == null);
  // Shared-in rocks belong on the Active list only — they archive on the
  // parent team, not here.
  //
  // Owner on this roster → their own section (with a "from {team}" chip);
  // otherwise → "Shared by {owner}" at the bottom.
  const { ownerOnRoster: sharedIntoSections, sharedBy: sharedRocksBelow } =
    partitionSharedRocks(sharedRocksRaw, rosterIds);

  // A viewer with full access to a shared-in rock (member of its parent
  // team, or admin) edits it *as the parent team*: the modal needs that
  // team's roster for the owner / milestone-owner pickers. Bounded by the
  // viewer's own memberships, and per-request cached.
  const editableParentIds = [
    ...new Set(
      sharedRocksRaw
        .filter((r) => rockAccessFor(r, viewer) === "edit")
        .map((r) => r.team_id),
    ),
  ];
  const parentRosters = new Map<string, TeamMember[]>(
    await Promise.all(
      editableParentIds.map(
        async (id) => [id, await getTeamMembers(id)] as const,
      ),
    ),
  );

  // Own and shared-in rocks are full views (lib/rocks-share.ts): every
  // milestone, locked ones included. Only assignment rows (below) narrow.
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
  for (const d of statusSnap.docs) {
    const x = d.data();
    const rockId = x.rock_id as string | undefined;
    if (!rockId) continue;
    const created = x.created_at as { toMillis?: () => number } | null;
    const entry: StatusUpdateSerialized = {
      id: d.id,
      status: String(x.status ?? ""),
      comment: (x.comment as string | null) ?? null,
      user_id: (x.user_id as string | null) ?? null,
      created_at_ms: created?.toMillis?.() ?? null,
      author_name: x.user_id
        ? (members.find((m) => m.user_id === x.user_id)?.full_name ?? "—")
        : "—",
    };
    const list = statusByRock.get(rockId) ?? [];
    list.push(entry);
    statusByRock.set(rockId, list);
  }
  for (const list of statusByRock.values()) {
    list.sort(
      (a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0),
    );
  }

  const sharedRockIds = sharedRocksRaw.map((r) => r.id);
  if (sharedRockIds.length > 0) {
    const extraMilestones = await loadMilestonesForRocks(db, sharedRockIds);
    const extraStatusSnaps = await Promise.all(
      chunkForInQuery(sharedRockIds).map((ids) =>
        db
          .collection("rock_status_updates")
          .where("rock_id", "in", ids)
          .get(),
      ),
    );
    for (const d of extraMilestones) addMilestone(d.id, d.data() as TodoDoc);
    for (const snap of extraStatusSnaps) {
      for (const d of snap.docs) {
        const x = d.data();
        const rockId = x.rock_id as string | undefined;
        if (!rockId) continue;
        const created = x.created_at as { toMillis?: () => number } | null;
        const entry: StatusUpdateSerialized = {
          id: d.id,
          status: String(x.status ?? ""),
          comment: (x.comment as string | null) ?? null,
          user_id: (x.user_id as string | null) ?? null,
          created_at_ms: created?.toMillis?.() ?? null,
          author_name: "—",
        };
        const list = statusByRock.get(rockId) ?? [];
        list.push(entry);
        statusByRock.set(rockId, list);
      }
    }
  }

  for (const list of milestonesByRock.values()) {
    list.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  }
  for (const list of statusByRock.values()) {
    list.sort(
      (a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0),
    );
  }

  // Rocks this team sees only because its people carry milestones on them
  // (lib/rocks-share.ts assignmentCarriers). Each renders under the
  // carrier's own section with only that carrier's unlocked milestones and
  // no progress; a viewer who has the rock in full (parent/shared team,
  // admin, or an assignee) still gets the whole rock in its detail and edit
  // views. Active list only — they are not this team's to archive.
  type CarrierInfo = {
    rowKey: string;
    realOwnerId: string | null;
    milestones: MilestoneSerialized[];
    full: MilestoneSerialized[] | null;
    /** The row exists only for the viewer (their locked milestones). */
    viewerOnly: boolean;
  };
  type CarrierRow = WithId<RockDoc> & { __carrier: CarrierInfo };
  const carrierRows: CarrierRow[] = [];
  if (!showArchived) {
    const assigned = await loadAssignedRocks(
      db,
      [...rosterIds],
      new Set([
        ...teamRocks.own.map((d) => d.id),
        ...teamRocks.shared.map((d) => d.id),
      ]),
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
      const rock = {
        id: d.id,
        team_id: x.team_id as string,
        title: x.title as string,
        owner_id: (x.owner_id as string | null) ?? null,
        quarter: x.quarter as string,
        due_date: (x.due_date as string | null) ?? null,
        status: x.status as string,
        description: (x.description as string | null) ?? null,
        rock_type: (x.rock_type as string | null) ?? null,
        is_company_rock: x.is_company_rock === true,
        shared_team_ids: (x.shared_team_ids as string[] | null) ?? [],
        team_only: x.team_only === true,
        archived_at: null,
      };
      const ms = (msByRock.get(d.id) ?? []).map(({ id, t }) => ({
        ...t,
        id,
      }));
      const byDue = (a: MilestoneSerialized, b: MilestoneSerialized) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
      const full = hasFullRockView(rock, viewer, ms)
        ? ms.map((m) => serializeMilestone(m.id, m)).sort(byDue)
        : null;
      // Viewer's own milestones join their section, greyed where only
      // they see them (lib/rocks-share.ts carriersForViewer).
      const { carriers, onlyViewerIds, viewerOnlyRow } = carriersForViewer(
        rock,
        teamId,
        rosterIds,
        ms,
        assigned.parentMembers.get(d.id) ?? new Set(),
        uid,
      );
      for (const [carrierId, list] of carriers) {
        carrierRows.push({
          ...rock,
          owner_id: carrierId,
          __carrier: {
            rowKey: `${d.id}:${carrierId}`,
            realOwnerId: rock.owner_id,
            milestones: list
              .map((m) => ({
                ...serializeMilestone(m.id, m),
                only_you: onlyViewerIds.has(m.id),
              }))
              .sort(byDue),
            full,
            viewerOnly: carrierId === uid && viewerOnlyRow,
          },
        } as CarrierRow);
      }
    }
  }

  const extraNameIds = [
    ...sharedRocksRaw.map((r) => r.owner_id),
    ...carrierRows.flatMap((r) => [
      r.__carrier.realOwnerId,
      ...(r.__carrier.full ?? r.__carrier.milestones).map((m) => m.owner_id),
    ]),
    // Guest-team members can own milestones on this team's rocks now.
    ...[...milestonesByRock.values()].flatMap((list) =>
      list.map((m) => m.owner_id),
    ),
    ...[...statusByRock.values()].flatMap((list) =>
      list.map((e) => e.user_id),
    ),
  ].filter((id): id is string => !!id && !members.some((m) => m.user_id === id));
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
  // the roster they are handed, and that is not always this team's: a
  // shared-in rock at "edit" renders with its PARENT roster (rowProps), so
  // a milestone owned by someone on this team would otherwise read "—".
  for (const list of [
    ...milestonesByRock.values(),
    ...carrierRows.flatMap((r) => [
      r.__carrier.milestones,
      r.__carrier.full ?? [],
    ]),
  ]) {
    for (const m of list) {
      if (m.owner_id) m.owner_label = ownerName(m.owner_id);
    }
  }

  for (const list of statusByRock.values()) {
    for (const e of list) {
      if (e.author_name === "—" && e.user_id) {
        e.author_name = ownerName(e.user_id);
      }
    }
  }

  // All view: Company section first, then Department (shared ownership +
  // Team rocks, even when a person is accountable), then members A–Z, then
  // owners no longer on the roster. A rock lands in exactly one section down
  // that ladder (lib/rock-bucket.ts). L10 matches (see segment-rocks.tsx).
  //
  // A shared-in rock whose owner sits on this roster skips the ladder and
  // files under that person: on the guest team it is "something Daniel is
  // carrying elsewhere", not one of this team's Company / Team priorities.
  type RockWithId = WithId<RockDoc>;
  type RockGroup = {
    key: string;
    title: string;
    rocks: RockWithId[];
  };
  const bucketOf = (r: RockWithId) =>
    r.team_id === teamId ? rockBucket(r) : "owner";

  function buildSections(rocks: RockWithId[]): RockGroup[] {
    if (filter !== "all") {
      // Person filter: their individual/company rocks + any they own that
      // aren't in the shared department bucket for this view.
      const list = rocks.filter((r) => r.owner_id === filter);
      if (list.length === 0) return [];
      return [
        { key: filter, title: ownerName(filter), rocks: sortRocks(list) },
      ];
    }

    const companyRocks: RockWithId[] = [];
    const deptRocks: RockWithId[] = [];
    const byOwner = new Map<string, RockWithId[]>();
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
      : [...allRocks, ...sharedIntoSections, ...carrierRows],
  );

  const sharedForView = showArchived
    ? []
    : filter === "all"
      ? sharedRocksBelow
      : sharedRocksBelow.filter((r) => r.owner_id === filter);
  const sharedGroups = groupSharedRocksByOwner(
    sharedForView.map((r) => ({ ...r, team_id: r.team_id })),
    ownerName,
  ).map((g) => ({
    ...g,
    rocks: sortRocks(g.rocks),
  }));

  const emptyMessage = showArchived
    ? "No archived rocks yet."
    : filter === "all"
      ? "No rocks yet."
      : `No rocks for ${ownerName(filter)}.`;

  const ownerFilter =
    filter !== "all" && filter !== "team" ? filter : undefined;

  // Per-row wiring. A rock on this team renders as-is. A shared-in rock at
  // "edit" access renders AS ITS PARENT TEAM — actions, roster, share picker
  // — so the existing server gates (requireTeamDoc on the parent) hold; at
  // "status" / "read" it renders against this team, read-mostly.
  function rowProps(r: RockWithId) {
    if (r.team_id === teamId) {
      return {
        teamId,
        members,
        teamName: team.name,
        shareTeams,
        canFlagCompany,
        access: "edit" as const,
        fromTeamName: undefined,
      };
    }
    const access = rockAccessFor(r, viewer);
    const fromTeamName = teamNameById.get(r.team_id) ?? "another team";
    if (access === "edit") {
      return {
        teamId: r.team_id,
        members: parentRosters.get(r.team_id) ?? members,
        teamName: fromTeamName,
        shareTeams: shareTeamsExcluding(r.team_id),
        canFlagCompany,
        access,
        fromTeamName,
      };
    }
    return {
      teamId,
      members,
      teamName: team.name,
      shareTeams,
      canFlagCompany: false,
      access,
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
                const carrier = (r as Partial<CarrierRow>).__carrier;
                if (carrier) {
                  // Grouped under the carrier; rendered as the real rock.
                  const rock = { ...r, owner_id: carrier.realOwnerId };
                  return (
                    <RockRow
                      key={carrier.rowKey}
                      {...rowProps(rock)}
                      userId={uid}
                      rock={rock}
                      ownerName={ownerName(carrier.realOwnerId)}
                      milestones={carrier.milestones}
                      fullMilestones={carrier.full ?? undefined}
                      carrierView
                      viewerOnly={carrier.viewerOnly}
                      defaultDue={eoq}
                      statusHistory={[]}
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
