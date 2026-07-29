import { Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { currentQuarter, endOfQuarter, toDateString } from "@/lib/dates";
import { OwnerFilter } from "./owner-filter";
import { AddRockDrawer } from "./add-rock-drawer";
import { RockRow } from "./rock-row";
import { isTeamRock } from "./rock-type";
import type { MilestoneSerialized } from "./milestones";

type RockDoc = {
  team_id: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
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
  searchParams: Promise<{ owner?: string }>;
}) {
  const { teamId } = await params;
  const { owner: ownerParam } = await searchParams;
  const { uid, db, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const quarter = currentQuarter();
  const eoq = toDateString(endOfQuarter());

  // Fetch rocks and team todos in parallel — milestones live in todos with
  // source_rock_id set, so one query covers both surfaces.
  const [rocksSnap, todosSnap] = await Promise.all([
    db.collection("rocks").where("team_id", "==", teamId).get(),
    db.collection("todos").where("team_id", "==", teamId).get(),
  ]);

  // Project plain fields only — spreading d.data() would pull created_at
  // (Firestore Timestamp) across the RSC boundary into RockDetailTrigger.
  const allRocks = rocksSnap.docs.map((d) => {
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
    };
  });

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

  // All view: Team section first, then members A–Z, then owners no longer on
  // the roster. L10 is Team → speaker order (see segment-rocks.tsx).
  type RockWithId = { id: string } & RockDoc;
  type RockGroup = {
    key: string;
    title: string;
    rocks: RockWithId[];
  };

  function buildSections(rocks: RockWithId[]): RockGroup[] {
    if (filter !== "all") {
      const list = rocks.filter((r) => r.owner_id === filter);
      if (list.length === 0) return [];
      return [
        { key: filter, title: ownerName(filter), rocks: sortRocks(list) },
      ];
    }

    const teamRocks: RockWithId[] = [];
    const byOwner = new Map<string, RockWithId[]>();
    for (const r of rocks) {
      if (isTeamRock(r.owner_id)) {
        teamRocks.push(r);
        continue;
      }
      const id = r.owner_id as string;
      const list = byOwner.get(id) ?? [];
      list.push(r);
      byOwner.set(id, list);
    }

    const groups: RockGroup[] = [];
    if (teamRocks.length > 0) {
      groups.push({ key: "team", title: "Team", rocks: sortRocks(teamRocks) });
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

  const emptyMessage =
    filter === "all" ? "No rocks yet." : `No rocks for ${ownerName(filter)}.`;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rocks</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {team.name} · all quarters · click a title to view · pencil to edit
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OwnerFilter members={members} currentUserId={uid} />
          <AddRockDrawer
            teamId={teamId}
            members={members}
            quarter={quarter}
            defaultDue={eoq}
            currentUserId={uid}
          />
        </div>
      </header>

      {sections.length === 0 ? (
        <RockSection title="Rocks">
          <Empty>{emptyMessage}</Empty>
        </RockSection>
      ) : (
        sections.map((g) => (
          <RockSection key={g.key} title={`${g.title} (${g.rocks.length})`}>
            {g.rocks.map((r) => (
              <RockRow
                key={r.id}
                teamId={teamId}
                rock={r}
                ownerName={
                  isTeamRock(r.owner_id) ? "Team" : ownerName(r.owner_id)
                }
                members={members}
                milestones={milestonesByRock.get(r.id) ?? []}
                defaultDue={eoq}
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
        {title}
      </h2>
      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState icon={Target} title={children} />;
}
