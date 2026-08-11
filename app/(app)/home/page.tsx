import Link from "next/link";
import { Circle } from "lucide-react";
import { daysUntil, formatDateOnly } from "@/lib/dates";
import { chunkForInQuery } from "@/lib/firestore-in";
import {
  byDueDateAsc,
  homeRockPillKind,
  rockHasMyOpenMilestone,
  selectHomeTodos,
  selectMilestonesForRocks,
  shouldShowHomeRock,
  todoVisibilityLabel,
} from "@/lib/home-board";
import { EmptyState } from "@/components/empty-state";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import {
  HomeRocksList,
  type HomeRockListItem,
} from "./home-rocks-list";

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

export default async function HomePage() {
  const { user, teams, membershipTeamIds, isAdmin, db } =
    await getUserTeamsFirebase();

  // Prefer real memberships for "my teams"; admins with no roster see nothing
  // personal (won't happen in prod). Fall back to navigable teams if needed.
  const myTeamIdsList =
    membershipTeamIds.length > 0 ? membershipTeamIds : teams.map((t) => t.id);
  const myTeamIds = new Set(myTeamIdsList);
  const teamChunks = chunkForInQuery(myTeamIdsList);

  const [todoSnaps, rockSnaps, sharedRockSnaps, memberSnaps] =
    await Promise.all([
      // Open todos on my teams (team-visible) + my private. Filtered to mine
      // for the To-Dos column; milestones used for rock expand + inclusion.
      Promise.all(
        teamChunks.flatMap((ids) => {
          const open = db
            .collection("todos")
            .where("team_id", "in", ids)
            .where("completed_at", "==", null);
          return [
            open.where("visibility", "==", "team").get(),
            open
              .where("visibility", "==", "private")
              .where("owner_id", "==", user.id)
              .get(),
          ];
        }),
      ),
      // Active rocks home'd on my teams.
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

  const todos = todoSnaps.flatMap((snap) =>
    snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TodoRow, "id">) })),
  ) as TodoRow[];

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

  // All open milestones on known rocks (for expand + my-milestone inclusion).
  const allMilestones = selectMilestonesForRocks(
    todos.filter((t) => t.source_rock_id) as TodoRow[],
    rockStatusById,
  );

  // If a rock was only pulled for my milestone but its other milestones
  // weren't in the team todo query (unlikely when same team_id), fetch them.
  const shownCandidateIds = new Set<string>();
  for (const r of rocks) {
    const mine = rockHasMyOpenMilestone(r.id, allMilestones, user.id);
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

  // Milestones for rocks on teams we're not querying fully: load by rock id.
  const rocksNeedingMs = [...shownCandidateIds].filter((id) => {
    const r = rockById.get(id);
    return r && !myTeamIds.has(r.team_id);
  });
  if (rocksNeedingMs.length > 0) {
    const extraMsSnaps = await Promise.all(
      rocksNeedingMs.map((rockId) =>
        db
          .collection("todos")
          .where("source_rock_id", "==", rockId)
          .where("completed_at", "==", null)
          .get(),
      ),
    );
    for (const snap of extraMsSnaps) {
      for (const d of snap.docs) {
        if (todos.some((t) => t.id === d.id)) continue;
        todos.push({
          id: d.id,
          ...(d.data() as Omit<TodoRow, "id">),
        });
      }
    }
  }

  const milestones = selectMilestonesForRocks(
    todos.filter((t) => t.source_rock_id) as TodoRow[],
    rockStatusById,
  );
  const milestonesByRock = new Map<string, TodoRow[]>();
  for (const m of milestones) {
    const rid = m.source_rock_id as string;
    const list = milestonesByRock.get(rid) ?? [];
    list.push(m);
    milestonesByRock.set(rid, list);
  }
  for (const list of milestonesByRock.values()) {
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
          milestones,
          user.id,
        ),
      }),
    )
    .sort(byDueDateAsc);

  const rockItems: HomeRockListItem[] = homeRocks.map((r) => {
    const kind = homeRockPillKind(r);
    const teamName = teamNameById.get(r.team_id) ?? "Team";
    // Full names only — acronyms/initials were hard to parse on Home.
    let pillLabel: string;
    if (kind === "team") {
      pillLabel = teamName;
    } else if (r.owner_id === user.id) {
      pillLabel = "You";
    } else {
      pillLabel =
        (r.owner_id && nameByUserId.get(r.owner_id)) || "Unknown owner";
    }

    const ms = milestonesByRock.get(r.id) ?? [];
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_date: r.due_date,
      quarter: r.quarter || "",
      team_id: r.team_id,
      href: `/teams/${r.team_id}/rocks`,
      pillLabel,
      pillTitle: pillLabel,
      pillKind: kind,
      milestones: ms.map((m) => ({
        id: m.id,
        title: m.title,
        due_date: m.due_date,
        isMine: m.owner_id === user.id,
      })),
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Your to-dos and rocks across teams.
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
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <HomeColumn title="To-Dos" count={myTodos.length}>
          {myTodos.length === 0 && <Empty>No open to-dos of yours.</Empty>}
          {myTodos.map((t) => (
            <TodoRowLink key={t.id} todo={t} />
          ))}
        </HomeColumn>

        <HomeColumn title="Rocks" count={rockItems.length}>
          <HomeRocksList rocks={rockItems} />
        </HomeColumn>
      </div>
    </div>
  );
}

function TodoRowLink({ todo }: { todo: TodoRow }) {
  const vis = todoVisibilityLabel(todo.visibility);
  return (
    <Link
      href={`/teams/${todo.team_id}/todos`}
      className="flex items-start gap-3 px-3.5 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
    >
      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {todo.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <VisibilityPill label={vis} />
          <DueLabel due={todo.due_date} />
        </div>
      </div>
    </Link>
  );
}

function VisibilityPill({ label }: { label: "Public" | "Private" }) {
  return (
    <span
      className={
        label === "Private"
          ? "inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-inset ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800"
          : "inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
      }
    >
      {label}
    </span>
  );
}

function HomeColumn({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        {title} ({count})
      </h2>
      <div className="max-h-[min(70vh,40rem)] divide-y divide-zinc-200 overflow-y-auto rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState title={children} />;
}

function DueLabel({ due }: { due: string | null }) {
  if (!due)
    return (
      <span className="text-xs whitespace-nowrap text-zinc-500">No due date</span>
    );
  const overdue = daysUntil(due) < 0;
  return (
    <span
      className={
        "text-xs whitespace-nowrap " +
        (overdue ? "text-red-600" : "text-zinc-600 dark:text-zinc-400")
      }
    >
      Due {formatDateOnly(due)}
    </span>
  );
}
