import Link from "next/link";
import { Archive, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { currentQuarter, endOfQuarter, toDateString } from "@/lib/dates";
import { OwnerFilter } from "./owner-filter";
import { NewRockButton } from "./rock-modal";
import { RockRow } from "./rock-row";
import {
  DEPARTMENT_SECTION_TITLE,
  isDepartmentRock,
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
  shared_team_ids?: string[] | null;
  archived_at?: unknown;
  /** Present when this row is a guest rock shared *into* the current team. */
  shared_from_team_name?: string | null;
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
  const [{ teams: userTeams }, members] = await Promise.all([
    getUserTeamsFirebase(),
    getTeamMembers(teamId),
  ]);
  const shareTeams = userTeams
    .filter((t) => t.id !== teamId)
    .map((t) => ({ id: t.id, name: t.name }));

  const quarter = currentQuarter();
  const eoq = toDateString(endOfQuarter());

  // Fetch home-team rocks, rocks shared *into* this team, todos (milestones),
  // and status history in parallel.
  // Status comments live in rock_status_updates (append-only); they were
  // written on save but never rendered — P0-5 / Jenna P14-3.
  const [rocksSnap, sharedIntoSnap, todosSnap, statusSnap] = await Promise.all([
    db.collection("rocks").where("team_id", "==", teamId).get(),
    db
      .collection("rocks")
      .where("shared_team_ids", "array-contains", teamId)
      .get(),
    db.collection("todos").where("team_id", "==", teamId).get(),
    db
      .collection("rock_status_updates")
      .where("team_id", "==", teamId)
      .get(),
  ]);

  // Resolve names for parent teams of shared-in rocks.
  const parentTeamIds = [
    ...new Set(
      sharedIntoSnap.docs
        .map((d) => d.data().team_id as string)
        .filter((id) => id && id !== teamId),
    ),
  ];
  const parentTeamName = new Map<string, string>();
  if (parentTeamIds.length > 0) {
    const parentDocs = await db.getAll(
      ...parentTeamIds.map((id) => db.collection("teams").doc(id)),
    );
    for (const d of parentDocs) {
      if (d.exists) {
        parentTeamName.set(d.id, (d.data()?.name as string) ?? "Team");
      }
    }
  }

  function projectRock(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: { id: string; data: () => any },
    opts?: { sharedFrom?: string | null },
  ) {
    const x = d.data() ?? {};
    return {
      id: d.id,
      team_id: x.team_id as string,
      title: x.title as string,
      owner_id: (x.owner_id as string | null) ?? null,
      quarter: (x.quarter as string) ?? "",
      due_date: (x.due_date as string | null) ?? null,
      status: x.status as string,
      description: (x.description as string | null) ?? null,
      rock_type: (x.rock_type as string | null) ?? null,
      shared_team_ids: (x.shared_team_ids as string[] | null) ?? [],
      archived_at: x.archived_at ?? null,
      shared_from_team_name: opts?.sharedFrom ?? null,
    };
  }

  // Project plain fields only — spreading d.data() would pull created_at
  // (Firestore Timestamp) across the RSC boundary into RockDetailTrigger.
  const homeRocks = rocksSnap.docs.map((d) => projectRock(d));
  const seenIds = new Set(homeRocks.map((r) => r.id));
  const sharedIn = sharedIntoSnap.docs
    .filter((d) => !seenIds.has(d.id))
    .map((d) => {
      const parentId = d.data().team_id as string;
      return projectRock(d, {
        sharedFrom: parentTeamName.get(parentId) ?? "Other team",
      });
    });
  const allRocksRaw = [...homeRocks, ...sharedIn];
  // Active/Archived tabs; Monday CF moves Done rocks (completed_at before
  // this week's Monday) onto Archived.
  const activeRockCount = allRocksRaw.filter((r) => r.archived_at == null)
    .length;
  const archivedRockCount = allRocksRaw.filter((r) => r.archived_at != null)
    .length;
  const allRocks = allRocksRaw.filter((r) =>
    showArchived ? r.archived_at != null : r.archived_at == null,
  );

  // Guest rock milestones live on the parent team_id — fetch by source_rock_id.
  const guestRockIds = sharedIn.map((r) => r.id);
  const guestMilestoneSnaps =
    guestRockIds.length === 0
      ? []
      : await Promise.all(
          // Firestore `in` max 30.
          chunk(guestRockIds, 30).map((ids) =>
            db
              .collection("todos")
              .where("source_rock_id", "in", ids)
              .get(),
          ),
        );
  const guestStatusSnaps =
    guestRockIds.length === 0
      ? []
      : await Promise.all(
          chunk(guestRockIds, 30).map((ids) =>
            db
              .collection("rock_status_updates")
              .where("rock_id", "in", ids)
              .get(),
          ),
        );

  // Reshape to plain data: TodoDoc.completed_at is a Firestore Timestamp,
  // which can't cross the Server → Client component boundary.
  const milestonesByRock = new Map<string, MilestoneSerialized[]>();
  for (const d of [...todosSnap.docs, ...guestMilestoneSnaps.flatMap((s) => s.docs)]) {
    const t = d.data() as TodoDoc & { source_rock_id?: string | null };
    if (!t.source_rock_id) continue;
    if (milestonesByRock.get(t.source_rock_id)?.some((m) => m.id === d.id)) {
      continue;
    }
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
  for (const d of [...statusSnap.docs, ...guestStatusSnaps.flatMap((s) => s.docs)]) {
    const x = d.data();
    const rockId = x.rock_id as string | undefined;
    if (!rockId) continue;
    if (statusByRock.get(rockId)?.some((e) => e.id === d.id)) continue;
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

  // Owner labels: roster first; shared-in rocks may name owners off-roster.
  const extraOwnerIds = [
    ...new Set(
      allRocksRaw
        .map((r) => r.owner_id)
        .filter((id): id is string => !!id && !rosterIds.has(id)),
    ),
  ];
  const extraOwnerNames = new Map<string, string>();
  if (extraOwnerIds.length > 0) {
    const userDocs = await db.getAll(
      ...extraOwnerIds.map((id) => db.collection("users").doc(id)),
    );
    for (const d of userDocs) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      const name =
        (data.display_name as string) ||
        [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
        (data.email as string) ||
        "—";
      extraOwnerNames.set(d.id, name);
    }
  }

  const ownerName = (id: string | null) => {
    if (!id) return "—";
    return (
      members.find((m) => m.user_id === id)?.full_name ??
      extraOwnerNames.get(id) ??
      "—"
    );
  };

  // All view: Department section first (type department/company, or legacy
  // null owner), then members A–Z, then owners no longer on the roster.
  // Shared-in rocks sit in those sections with a "from {team}" cue on the row.
  // L10 matches (see segment-rocks.tsx).
  type RockWithId = { id: string } & RockDoc;
  type RockGroup = {
    key: string;
    title: string;
    rocks: RockWithId[];
  };

  function buildSections(rocks: RockWithId[]): RockGroup[] {
    if (filter !== "all") {
      // Person filter: every rock they own (department + individual).
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
      const id = r.owner_id ?? "_unknown";
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

    // Owners not on the current roster (left the team, shared-in owner, stale).
    const orphanIds = [...byOwner.keys()].filter(
      (id) => id !== "_unknown" && !rosterIds.has(id),
    );
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

  const ownerQuery =
    filter !== "all" && filter !== "team" ? `owner=${filter}` : "";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rocks</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {showArchived
              ? "Done rocks move here after the Monday archive sweep (completed before this week)."
              : "Quarterly priorities. Mark a rock Done — it stays on Active until next Monday’s archive sweep."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-[9px] bg-zinc-100 p-[3px] text-sm dark:bg-zinc-800">
            <Link
              href={
                ownerQuery
                  ? `/teams/${teamId}/rocks?${ownerQuery}`
                  : `/teams/${teamId}/rocks`
              }
              className={
                !showArchived
                  ? "rounded-[7px] bg-white px-3 py-[5px] font-bold text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                  : "rounded-[7px] px-3 py-[5px] font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }
            >
              Active ({activeRockCount})
            </Link>
            <Link
              href={
                ownerQuery
                  ? `/teams/${teamId}/rocks?archived=1&${ownerQuery}`
                  : `/teams/${teamId}/rocks?archived=1`
              }
              className={
                showArchived
                  ? "inline-flex items-center gap-1.5 rounded-[7px] bg-white px-3 py-[5px] font-bold text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                  : "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-[5px] font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }
            >
              <Archive className="h-3.5 w-3.5" />
              Archived ({archivedRockCount})
            </Link>
          </div>
          {!showArchived && (
            <>
              <OwnerFilter members={members} currentUserId={uid} />
              <NewRockButton
                teamId={teamId}
                members={members}
                quarter={quarter}
                defaultDue={eoq}
                currentUserId={uid}
                teamName={team.name}
                shareTeams={shareTeams}
              />
            </>
          )}
        </div>
      </header>

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
            {g.rocks.map((r) => {
              const isGuest = r.team_id !== teamId;
              return (
                <RockRow
                  key={r.id}
                  teamId={isGuest ? r.team_id : teamId}
                  userId={uid}
                  rock={r}
                  ownerName={ownerName(r.owner_id)}
                  members={members}
                  milestones={milestonesByRock.get(r.id) ?? []}
                  defaultDue={eoq}
                  statusHistory={statusByRock.get(r.id) ?? []}
                  currentUserId={uid}
                  teamName={team.name}
                  shareTeams={shareTeams}
                  sharedFromLabel={r.shared_from_team_name ?? null}
                  readOnly={isGuest}
                />
              );
            })}
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
