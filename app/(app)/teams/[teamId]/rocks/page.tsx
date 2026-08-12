import { Archive, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { currentQuarter, endOfQuarter, toDateString } from "@/lib/dates";
import { NewRockButton } from "./rock-modal";
import { RockRow } from "./rock-row";
import {
  DEPARTMENT_SECTION_TITLE,
  isDepartmentRock,
  isSharedDepartmentOwner,
} from "./rock-type";
import type { MilestoneSerialized } from "./milestone-checklist";
import type { StatusUpdateSerialized } from "./status-history";

type RockDoc = {
  team_id: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
  archived_at?: unknown;
};

type TodoDoc = {
  team_id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | null;
  visibility: "team" | "private";
  source_issue_id: string | null;
  source_meeting_id: string | null;
  source_rock_id: string | null;
  description: string | null;
};

const STATUS_ORDER = ["on_track", "off_track", "done", "cancelled"];

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
  const { uid, db, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const quarter = currentQuarter();
  const eoq = toDateString(endOfQuarter());

  // Fetch rocks, todos (milestones), and status history in parallel.
  // Status comments live in rock_status_updates (append-only); they were
  // written on save but never rendered — P0-5 / Jenna P14-3.
  const [rocksSnap, todosSnap, statusSnap] = await Promise.all([
    db.collection("rocks").where("team_id", "==", teamId).get(),
    db.collection("todos").where("team_id", "==", teamId).get(),
    db
      .collection("rock_status_updates")
      .where("team_id", "==", teamId)
      .get(),
  ]);

  // Project plain fields only — spreading d.data() would pull created_at
  // (Firestore Timestamp) across the RSC boundary into RockDetailTrigger.
  const allRocksRaw = rocksSnap.docs.map((d) => {
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
      archived_at: x.archived_at ?? null,
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

  // Reshape to plain data: TodoDoc.completed_at is a Firestore Timestamp,
  // which can't cross the Server → Client component boundary.
  const milestonesByRock = new Map<string, MilestoneSerialized[]>();
  for (const d of todosSnap.docs) {
    const t = d.data() as TodoDoc;
    if (!t.source_rock_id) continue;
    const m: MilestoneSerialized = {
      id: d.id,
      title: t.title,
      owner_id: t.owner_id,
      due_date: t.due_date,
      completed: !!t.completed_at,
      description: t.description ?? null,
    };
    const list = milestonesByRock.get(t.source_rock_id) ?? [];
    list.push(m);
    milestonesByRock.set(t.source_rock_id, list);
  }
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

  for (const list of milestonesByRock.values()) {
    list.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
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
  const rosterIds = new Set(members.map((m) => m.user_id));
  const filter = rosterIds.has(legacyMapped) ? legacyMapped : "all";

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  // All view: Department section first (shared ownership + Level=Department
  // rocks, even when a person is accountable), then members A–Z, then owners
  // no longer on the roster. L10 matches (see segment-rocks.tsx).
  type RockWithId = { id: string } & RockDoc;
  type RockGroup = {
    key: string;
    title: string;
    rocks: RockWithId[];
  };

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

    const deptRocks: RockWithId[] = [];
    const byOwner = new Map<string, RockWithId[]>();
    for (const r of rocks) {
      if (isDepartmentRock(r)) {
        deptRocks.push(r);
        continue;
      }
      const id = r.owner_id as string;
      const list = byOwner.get(id) ?? [];
      list.push(r);
      byOwner.set(id, list);
    }

    const groups: RockGroup[] = [];
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

  const sections = buildSections(allRocks);

  const emptyMessage = showArchived
    ? "No archived rocks yet."
    : filter === "all"
      ? "No rocks yet."
      : `No rocks for ${ownerName(filter)}.`;

  const ownerFilter = filter !== "all" && filter !== "team" ? filter : undefined;

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
          />
        }
      />

      {sections.length === 0 ? (
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
        sections.map((g) => (
          <RockSection key={g.key} title={g.title} count={g.rocks.length}>
            {g.rocks.map((r) => (
              <RockRow
                key={r.id}
                teamId={teamId}
                userId={uid}
                rock={r}
                ownerName={
                  isSharedDepartmentOwner(r.owner_id)
                    ? DEPARTMENT_SECTION_TITLE
                    : ownerName(r.owner_id)
                }
                members={members}
                milestones={milestonesByRock.get(r.id) ?? []}
                defaultDue={eoq}
                statusHistory={statusByRock.get(r.id) ?? []}
                currentUserId={uid}
                teamName={team.name}
              />
            ))}
          </RockSection>
        ))
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
