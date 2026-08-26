import Link from "next/link";
import { Lock } from "lucide-react";
import { formatDateShort } from "@/lib/dates";
import { dueToneClass } from "@/lib/due";
import { chunkForInQuery } from "@/lib/firestore-in";
import {
  byDueDateAsc,
  homeRockPillKind,
  rockHasMyOpenMilestone,
  selectHomeTodos,
  selectMilestonesForRocks,
  shouldShowHomeRock,
  splitHomeRocksByType,
  todoVisibilityLabel,
} from "@/lib/home-board";
import {
  statusSortRank,
  trendStatus,
  type GoalDirection,
} from "@/lib/scorecard";
import {
  entriesToRecord,
  loadScorecardEntries,
} from "@/lib/scorecard-entries";
import {
  buildScorecardColumns,
  normalizeMetricInterval,
  oldestPeriodStart,
  PERIOD_LABELS,
  type MetricInterval,
} from "@/lib/scorecard-periods";
import { EmptyState } from "@/components/empty-state";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import {
  HomeRocksList,
  type HomeRockListItem,
} from "./home-rocks-list";
import {
  HomeMetricsList,
  type HomeMetricListItem,
} from "./home-metrics-list";
import { BoardColumn } from "@/components/board-column";
import { cn } from "@/lib/utils";

type TodoRow = {
  id: string;
  title: string;
  due_date: string | null;
  team_id: string;
  owner_id: string | null;
  visibility: string;
  completed_at: string | null;
  source_rock_id: string | null;
};

type RockRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  quarter: string;
  owner_id: string | null;
  team_id: string;
  rock_type?: string | null;
  archived_at?: unknown | null;
  shared_team_ids?: string[] | null;
};

type MetricRow = {
  id: string;
  team_id: string;
  name: string;
  unit: string;
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  interval: MetricInterval;
};

export default async function HomePage() {
  const { user, teams, membershipTeamIds, isAdmin, db } =
    await getUserTeamsFirebase();

  // Prefer real memberships for "my teams"; admins with no roster see nothing
  // personal (won't happen in prod). Fall back to navigable teams if needed.
  const myTeamIdsList =
    membershipTeamIds.length > 0 ? membershipTeamIds : teams.map((t) => t.id);
  const myTeamIds = new Set(myTeamIdsList);
  const teamChunks = chunkForInQuery(myTeamIdsList);

  const [todoSnaps, rockSnaps, sharedRockSnaps, memberSnaps, myMetricsSnap] =
    await Promise.all([
      // Open todos for the viewer's teams. Admin SDK can read everything; we
      // filter private rows in memory below (owner only). Prefer one query with
      // the existing team_id+completed_at composite over dual visibility queries
      // that need a 4-field index (team_id+completed_at+visibility+owner_id)
      // which is easy to miss in deploy — that gap dropped *all* private
      // to-dos from Home while Google Tasks still received them on write.
      Promise.all(
        teamChunks.map((ids) =>
          db
            .collection("todos")
            .where("team_id", "in", ids)
            .where("completed_at", "==", null)
            .get(),
        ),
      ),
      // Rocks: `team_id in` × `status in [2 values]` would multiply to 2× the
      // chunk size in disjunctions (over the 30 cap at 16+ teams), so run one
      // query per (chunk, status) pair instead.
      Promise.all(
        teamChunks.flatMap((ids) =>
          ["on_track", "off_track"].map((status) =>
            db
              .collection("rocks")
              .where("team_id", "in", ids)
              .where("status", "==", status)
              .get(),
          ),
        ),
      ),
      // Rocks shared *into* my teams (field optional; empty until share ships).
      // Status filtered in memory so we only need the array-contains index.
      Promise.all(
        myTeamIdsList.map((teamId) =>
          db
            .collection("rocks")
            .where("shared_team_ids", "array-contains", teamId)
            .get(),
        ),
      ),
      Promise.all(
        teamChunks.map((ids) =>
          db.collection("team_members").where("team_id", "in", ids).get(),
        ),
      ),
      // Personal scorecard metrics I own (any team).
      db.collection("scorecard_metrics").where("owner_id", "==", user.id).get(),
    ]);

  const memberUids = new Set<string>(
    memberSnaps.flatMap((s) => s.docs.map((d) => d.data().user_id as string)),
  );
  // Always resolve current user for pill labels.
  memberUids.add(user.id);

  const nameByUserId = new Map<string, string>();
  if (memberUids.size > 0) {
    const userDocs = await db.getAll(
      ...[...memberUids].map((id) => db.collection("users").doc(id)),
    );
    for (const d of userDocs) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      const name =
        (data.display_name as string) ||
        [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
        (data.email as string) ||
        "";
      if (name) nameByUserId.set(d.id, name);
    }
  }

  const todos = todoSnaps
    .flatMap((snap) =>
      snap.docs.map((d) => {
        const data = d.data() as Omit<TodoRow, "id"> & {
          archived_at?: unknown | null;
        };
        return { id: d.id, ...data };
      }),
    )
    .filter((t) => {
      // Active Home board: skip archived (can be incomplete if manual-archived).
      if (t.archived_at != null) return false;
      // Privacy: private only for the owner; missing/legacy visibility = team.
      if (t.visibility === "private") return t.owner_id === user.id;
      return true;
    }) as TodoRow[];

  const rockById = new Map<string, RockRow>();
  for (const snap of rockSnaps) {
    for (const d of snap.docs) {
      rockById.set(d.id, {
        id: d.id,
        ...(d.data() as Omit<RockRow, "id">),
      });
    }
  }
  for (const snap of sharedRockSnaps) {
    for (const d of snap.docs) {
      if (rockById.has(d.id)) continue;
      const row = {
        id: d.id,
        ...(d.data() as Omit<RockRow, "id">),
      };
      // Shared query is unfiltered by status; drop inactive here.
      if (row.status !== "on_track" && row.status !== "off_track") continue;
      if (row.archived_at != null) continue;
      rockById.set(d.id, row);
    }
  }

  // Rocks I only see via milestone assignment may live on teams already in
  // rockById; if not, fetch by id from my open milestones.
  const myMilestoneRockIds = [
    ...new Set(
      todos
        .filter((t) => t.source_rock_id && t.owner_id === user.id)
        .map((t) => t.source_rock_id as string),
    ),
  ];
  const missingRockIds = myMilestoneRockIds.filter((id) => !rockById.has(id));
  if (missingRockIds.length > 0) {
    const extra = await db.getAll(
      ...missingRockIds.map((id) => db.collection("rocks").doc(id)),
    );
    for (const d of extra) {
      if (!d.exists) continue;
      rockById.set(d.id, {
        id: d.id,
        ...(d.data() as Omit<RockRow, "id">),
      });
      const ownerId = d.data()?.owner_id as string | null | undefined;
      if (ownerId && !nameByUserId.has(ownerId)) {
        memberUids.add(ownerId);
      }
    }
    // Hydrate any newly discovered rock owners.
    const needNames = [...memberUids].filter((id) => !nameByUserId.has(id));
    if (needNames.length > 0) {
      const more = await db.getAll(
        ...needNames.map((id) => db.collection("users").doc(id)),
      );
      for (const d of more) {
        if (!d.exists) continue;
        const data = d.data() ?? {};
        const name =
          (data.display_name as string) ||
          [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
          (data.email as string) ||
          "";
        if (name) nameByUserId.set(d.id, name);
      }
    }
  }

  // Team names: membership teams + any parent team on a rock we show.
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const unknownTeamIds = [...rockById.values()]
    .map((r) => r.team_id)
    .filter((id) => id && !teamNameById.has(id));
  if (unknownTeamIds.length > 0) {
    const teamDocs = await db.getAll(
      ...[...new Set(unknownTeamIds)].map((id) =>
        db.collection("teams").doc(id),
      ),
    );
    for (const d of teamDocs) {
      if (!d.exists) continue;
      teamNameById.set(d.id, (d.data()?.name as string) ?? "Team");
    }
  }

  const rocks = [...rockById.values()];
  const rockStatusById = new Map(
    rocks.map((r) => [
      r.id,
      { status: r.status, archived_at: r.archived_at ?? null },
    ]),
  );

  // Open milestones on known rocks (for expand + my-milestone inclusion).
  const openMilestones = selectMilestonesForRocks(
    todos.filter((t) => t.source_rock_id) as TodoRow[],
    rockStatusById,
  );

  // Candidate rocks for Home (before loading full milestone counts).
  const shownCandidateIds = new Set<string>();
  for (const r of rocks) {
    const mine = rockHasMyOpenMilestone(r.id, openMilestones, user.id);
    if (
      shouldShowHomeRock(r, {
        uid: user.id,
        myTeamIds,
        hasMyOpenMilestone: mine,
      })
    ) {
      shownCandidateIds.add(r.id);
    }
  }

  // All milestones (open + completed) for shown rocks — progress fractions
  // need done/total; expand lists open ones only.
  const allMsByRock = new Map<
    string,
    Array<TodoRow & { completed: boolean }>
  >();
  if (shownCandidateIds.size > 0) {
    const msSnaps = await Promise.all(
      [...shownCandidateIds].map((rockId) =>
        db.collection("todos").where("source_rock_id", "==", rockId).get(),
      ),
    );
    let i = 0;
    for (const rockId of shownCandidateIds) {
      const snap = msSnaps[i++]!;
      const list: Array<TodoRow & { completed: boolean }> = [];
      for (const d of snap.docs) {
        const data = d.data() as Omit<TodoRow, "id">;
        list.push({
          id: d.id,
          ...data,
          completed: data.completed_at != null,
        });
        if (data.owner_id) memberUids.add(data.owner_id);
      }
      list.sort(byDueDateAsc);
      allMsByRock.set(rockId, list);
    }
    // Resolve any milestone owners not already named.
    const needNames = [...memberUids].filter((id) => !nameByUserId.has(id));
    if (needNames.length > 0) {
      const more = await db.getAll(
        ...needNames.map((id) => db.collection("users").doc(id)),
      );
      for (const d of more) {
        if (!d.exists) continue;
        const data = d.data() ?? {};
        const name =
          (data.display_name as string) ||
          [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
          (data.email as string) ||
          "";
        if (name) nameByUserId.set(d.id, name);
      }
    }
  }

  // Open milestones for expand: prefer full-fetch rows; fall back to team query.
  const openMsByRock = new Map<string, Array<TodoRow & { completed: boolean }>>();
  for (const [rid, list] of allMsByRock) {
    openMsByRock.set(
      rid,
      list.filter((m) => !m.completed),
    );
  }
  for (const m of openMilestones) {
    const rid = m.source_rock_id as string;
    if (!rid || allMsByRock.has(rid)) continue;
    const list = openMsByRock.get(rid) ?? [];
    list.push({ ...m, completed: false });
    openMsByRock.set(rid, list);
  }
  for (const list of openMsByRock.values()) {
    list.sort(byDueDateAsc);
  }

  const myTodos = selectHomeTodos(todos, user.id).sort(byDueDateAsc);

  const homeRocks: RockRow[] = rocks
    .filter((r) =>
      shouldShowHomeRock(r, {
        uid: user.id,
        myTeamIds,
        hasMyOpenMilestone: rockHasMyOpenMilestone(
          r.id,
          openMilestones,
          user.id,
        ),
      }),
    )
    .sort(byDueDateAsc);

  const rockItems: HomeRockListItem[] = homeRocks.map((r) => {
    const kind = homeRockPillKind(r);
    const teamName = teamNameById.get(r.team_id) ?? "Team";
    // Owner column: "You" / person name / team name for department rocks.
    let ownerLabel: string;
    if (kind === "team") {
      ownerLabel = teamName;
    } else if (r.owner_id === user.id) {
      ownerLabel = "You";
    } else {
      ownerLabel =
        (r.owner_id && nameByUserId.get(r.owner_id)) || "Unknown owner";
    }

    const allMs = allMsByRock.get(r.id) ?? [];
    const openMs = openMsByRock.get(r.id) ?? allMs.filter((m) => !m.completed);
    const milestoneTotal = allMs.length;
    const milestoneDone = allMs.filter((m) => m.completed).length;

    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_date: r.due_date,
      quarter: r.quarter || "",
      team_id: r.team_id,
      owner_id: r.owner_id ?? null,
      rock_type: r.rock_type ?? null,
      href: `/teams/${r.team_id}/rocks`,
      ownerLabel,
      milestoneDone,
      milestoneTotal,
      milestones: openMs.map((m) => {
        const isMine = m.owner_id === user.id;
        return {
          id: m.id,
          title: m.title,
          due_date: m.due_date,
          isMine,
          ownerLabel: isMine
            ? "You"
            : (m.owner_id && nameByUserId.get(m.owner_id)) || "—",
        };
      }),
    };
  });

  const { mine: myRocks, departmental: departmentalRocks } =
    splitHomeRocksByType(rockItems);

  // Personal scorecard: metrics I own on teams I can open.
  const myMetrics: MetricRow[] = myMetricsSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: (x.team_id as string) ?? "",
        name: (x.name as string) ?? "Metric",
        unit: (x.unit as string) ?? "number",
        goal: (x.goal as number | null) ?? null,
        direction: (x.direction as GoalDirection) ?? "gte",
        owner_id: (x.owner_id as string | null) ?? null,
        sort_order: (x.sort_order as number) ?? 0,
        interval: normalizeMetricInterval(x.interval as string | null),
      };
    })
    .filter((m) => m.team_id && myTeamIds.has(m.team_id));

  // Ensure team names for metric teams (usually already loaded).
  const metricTeamMissing = myMetrics
    .map((m) => m.team_id)
    .filter((id) => !teamNameById.has(id));
  if (metricTeamMissing.length > 0) {
    const teamDocs = await db.getAll(
      ...[...new Set(metricTeamMissing)].map((id) =>
        db.collection("teams").doc(id),
      ),
    );
    for (const d of teamDocs) {
      if (!d.exists) continue;
      teamNameById.set(d.id, (d.data()?.name as string) ?? "Team");
    }
  }

  const entryOldest = [
    oldestPeriodStart("weekly", 13),
    oldestPeriodStart("monthly", 12),
    oldestPeriodStart("quarterly", 8),
    oldestPeriodStart("annual", 5),
  ].sort()[0]!;

  const entryRecord = entriesToRecord(
    await loadScorecardEntries(
      db,
      myMetrics.map((m) => m.id),
      entryOldest,
    ),
  );

  const metricItems: HomeMetricListItem[] = myMetrics.map((m) => {
    const columns = buildScorecardColumns(m.interval, undefined, 13);
    const values = columns.map(
      (c) => entryRecord[`${m.id}__${c.id}`] ?? null,
    );
    const status = trendStatus(values, m.goal, m.direction);
    return {
      id: m.id,
      name: m.name,
      teamName: teamNameById.get(m.team_id) ?? "Team",
      unit: m.unit,
      goal: m.goal,
      direction: m.direction,
      intervalLabel: PERIOD_LABELS[m.interval],
      columns,
      values,
      status,
    };
  });

  metricItems.sort(
    (a, b) =>
      statusSortRank(a.status) - statusSortRank(b.status) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Your to-dos, rocks, and scorecard metrics across teams.
        </p>
        {membershipTeamIds.length === 0 && !isAdmin && (
          <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            You&apos;re not on a team yet, so there are no rocks or to-dos here.{" "}
            <Link
              href="/directory"
              className="font-medium text-hpb-blue underline-offset-2 hover:underline dark:text-hpb-gold"
            >
              Browse the Members directory
            </Link>{" "}
            — a leader will invite you when ready.
          </p>
        )}
        {isAdmin && membershipTeamIds.length === 0 && teams.length > 0 && (
          <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Showing all teams (admin). You are not on a roster yourself.
          </p>
        )}
      </header>

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,2.8fr)] lg:items-start">
          <BoardColumn scroll title="To-Dos" count={myTodos.length}>
            {myTodos.length === 0 && <Empty>No open to-dos of yours.</Empty>}
            {myTodos.map((t) => (
              <TodoRowLink key={t.id} todo={t} />
            ))}
          </BoardColumn>

          {/* N34: "My Rocks" and "Departmental Rocks" read as two lists, not
              one mixed one — Cora couldn't tell which rocks were actually
              hers. Split by rock_type, so a department rock she owns still
              sits with the department's. Either section is dropped entirely
              when empty rather than showing an empty-state twice. */}
          <div className="space-y-4">
            {myRocks.length > 0 && (
              <BoardColumn scroll title="My Rocks" count={myRocks.length} flush>
                <HomeRocksList rocks={myRocks} />
              </BoardColumn>
            )}
            {departmentalRocks.length > 0 && (
              <BoardColumn
                scroll
                title="Departmental Rocks"
                count={departmentalRocks.length}
                flush
              >
                <HomeRocksList rocks={departmentalRocks} />
              </BoardColumn>
            )}
            {rockItems.length === 0 && (
              <BoardColumn scroll title="Rocks" count={0} flush>
                <HomeRocksList rocks={[]} />
              </BoardColumn>
            )}
          </div>
        </div>

        <BoardColumn scroll title="My metrics" count={metricItems.length} flush>
          <HomeMetricsList metrics={metricItems} />
        </BoardColumn>
      </div>
    </div>
  );
}

function TodoRowLink({ todo }: { todo: TodoRow }) {
  const isPrivate = todoVisibilityLabel(todo.visibility) === "Private";
  return (
    <Link
      href={`/teams/${todo.team_id}/todos`}
      className="grid grid-cols-[20px_1fr_auto] items-center gap-2.5 px-3.5 py-[11px] text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-zinc-300 dark:border-zinc-600"
        aria-hidden
      />
      <div className="flex min-w-0 items-center gap-1.5">
        {isPrivate ? (
          <Lock
            className="h-3 w-3 shrink-0 text-zinc-400"
            aria-label="Private"
          />
        ) : null}
        <span className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
          {todo.title}
        </span>
      </div>
      <span
        className={cn(
          "text-[11.5px] font-bold tabular-nums whitespace-nowrap",
          dueToneClass(todo.due_date),
        )}
      >
        {todo.due_date ? formatDateShort(todo.due_date) : "—"}
      </span>
    </Link>
  );
}


function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState title={children} />;
}
