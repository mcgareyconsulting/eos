import { Trash2, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EditableText } from "@/components/editable-text";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { currentQuarter, endOfQuarter, toDateString } from "@/lib/dates";
import { StatusPopover } from "./status-popover";
import { MilestonesDisclosure, type MilestoneSerialized } from "./milestones";
import { OwnerFilter } from "./owner-filter";
import { AddRockDrawer } from "./add-rock-drawer";
import { deleteRock, updateRockTitle } from "./actions";
import { isTeamRock } from "./rock-type";

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

  const allRocks = rocksSnap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as RockDoc) }),
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
  for (const list of milestonesByRock.values()) {
    list.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  }

  // Filter: all | team | self | others (legacy mine → self).
  const filterRaw = ownerParam || "all";
  const filter =
    filterRaw === "mine"
      ? "self"
      : filterRaw === "team" ||
          filterRaw === "self" ||
          filterRaw === "others" ||
          filterRaw === "all"
        ? filterRaw
        : "all";

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  // Tab order: Team → Self → Others (A–Z). L10 is Team → speaker order
  // (see segment-rocks.tsx).
  type RockWithId = { id: string } & RockDoc;
  type RockGroup = {
    key: string;
    title: string;
    rocks: RockWithId[];
  };

  function groupByOwnerSections(
    rocks: RockWithId[],
    opts: { includeTeam: boolean; includeSelf: boolean; includeOthers: boolean },
  ): RockGroup[] {
    const teamRocks: RockWithId[] = [];
    const selfRocks: RockWithId[] = [];
    const otherRocks: RockWithId[] = [];
    for (const r of rocks) {
      if (isTeamRock(r.owner_id)) teamRocks.push(r);
      else if (r.owner_id === uid) selfRocks.push(r);
      else otherRocks.push(r);
    }

    const groups: RockGroup[] = [];
    if (opts.includeTeam && teamRocks.length > 0) {
      groups.push({
        key: "team",
        title: "Team",
        rocks: sortRocks(teamRocks),
      });
    }
    if (opts.includeSelf && selfRocks.length > 0) {
      groups.push({
        key: "self",
        title: "Self",
        rocks: sortRocks(selfRocks),
      });
    }
    if (opts.includeOthers) {
      const byOwner = new Map<string, RockWithId[]>();
      for (const r of otherRocks) {
        const id = r.owner_id as string;
        const list = byOwner.get(id) ?? [];
        list.push(r);
        byOwner.set(id, list);
      }

      const named = members
        .filter((m) => m.user_id !== uid)
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
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
      const memberIds = new Set(members.map((m) => m.user_id));
      const orphanIds = [...byOwner.keys()].filter(
        (id) => id !== uid && !memberIds.has(id),
      );
      orphanIds.sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
      for (const id of orphanIds) {
        const list = byOwner.get(id)!;
        groups.push({
          key: id,
          title: ownerName(id),
          rocks: sortRocks(list),
        });
      }
    }

    return groups;
  }

  const sectionOpts =
    filter === "team"
      ? { includeTeam: true, includeSelf: false, includeOthers: false }
      : filter === "self"
        ? { includeTeam: false, includeSelf: true, includeOthers: false }
        : filter === "others"
          ? { includeTeam: false, includeSelf: false, includeOthers: true }
          : { includeTeam: true, includeSelf: true, includeOthers: true };

  const sections = groupByOwnerSections(allRocks, sectionOpts);

  function renderRow(r: RockWithId) {
    const renameTitle = updateRockTitle.bind(null, teamId, r.id);
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
          {r.description && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-1">
              {r.description}
            </div>
          )}
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
            {r.quarter}
          </div>
        </div>
        <div className="col-span-1 text-zinc-600 dark:text-zinc-400 text-xs">
          {r.due_date ? new Date(r.due_date).toLocaleDateString() : "—"}
        </div>
        <div className="col-span-2 justify-self-end flex items-center gap-2">
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
          rockDescription={r.description}
          members={members}
          milestones={milestones}
          defaultDue={eoq}
        />
      </div>
    );
  }

  const emptyMessage =
    filter === "team"
      ? "No team rocks."
      : filter === "self"
        ? "None assigned to you."
        : filter === "others"
          ? "No rocks for other owners."
          : "No rocks yet.";

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
          <OwnerFilter />
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

