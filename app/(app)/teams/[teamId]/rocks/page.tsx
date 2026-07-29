import { Trash2, Target, Eye } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EditableText } from "@/components/editable-text";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { currentQuarter, endOfQuarter, formatDateOnly, toDateString } from "@/lib/dates";
import { StatusPopover } from "./status-popover";
import { MilestonesDisclosure, type MilestoneSerialized } from "./milestones";
import { OwnerFilter } from "./owner-filter";
import { AddRockDrawer } from "./add-rock-drawer";
import { deleteRock, updateRockDescription, updateRockTitle } from "./actions";
import { isTeamRock } from "./rock-type";
import { RockDetailTrigger } from "./rock-detail-modal";

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

// Within a section: status, then due date.
function sortRocks<
  T extends {
    status: string;
    due_date: string | null;
  },
>(rocks: T[]): T[] {
  return [...rocks].sort((a, b) => {
    const byStatus =
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
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

  function renderRow(r: RockWithId) {
    const renameTitle = updateRockTitle.bind(null, teamId, r.id);
    const editDescription = updateRockDescription.bind(null, teamId, r.id);
    const remove = deleteRock.bind(null, teamId, r.id);
    const milestones = milestonesByRock.get(r.id) ?? [];
    return (
      <div
        key={r.id}
        className="group grid grid-cols-12 gap-3 px-4 py-3 items-start text-sm"
      >
        <div className="col-span-9 min-w-0">
          <EditableText
            value={r.title}
            onSave={renameTitle}
            className="font-medium"
          />
          <EditableText
            value={r.description ?? ""}
            onSave={editDescription}
            multiline
            placeholder="Add a description"
            className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5"
          />
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
            {r.quarter}
          </div>
        </div>
        <div className="col-span-1 text-zinc-600 dark:text-zinc-400 text-xs">
          {r.due_date ? formatDateOnly(r.due_date) : "—"}
        </div>
        <div className="col-span-2 justify-self-end flex items-center gap-2">
          <RockDetailTrigger
            rock={r}
            ownerName={isTeamRock(r.owner_id) ? "Team" : ownerName(r.owner_id)}
            milestones={milestones.map((m) => ({
              id: m.id,
              title: m.title,
              due_date: m.due_date,
              completed: m.completed,
              owner_name: m.owner_id ? ownerName(m.owner_id) : null,
            }))}
            className="text-zinc-400 hover:text-hpb-blue dark:text-zinc-500 dark:hover:text-hpb-gold"
          >
            <Eye className="w-4 h-4" />
          </RockDetailTrigger>
          <StatusPopover teamId={teamId} rockId={r.id} status={r.status} />
          <form action={remove}>
            <button
              type="submit"
              className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
              aria-label="Delete rock"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </form>
        </div>
        <MilestonesDisclosure
          teamId={teamId}
          rockId={r.id}
          rockOwnerId={r.owner_id}
          members={members}
          milestones={milestones}
          defaultDue={eoq}
        />
      </div>
    );
  }

  const emptyMessage =
    filter === "all" ? "No rocks yet." : `No rocks for ${ownerName(filter)}.`;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rocks</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {team.name} · current quarter {quarter}
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
            {g.rocks.map(renderRow)}
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
      <h2 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200 mb-3">
        {title}
      </h2>
      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState icon={Target} title={children} />;
}

