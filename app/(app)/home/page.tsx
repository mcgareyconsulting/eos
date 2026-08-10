import Link from "next/link";
import { daysUntil, formatDateOnly, isDueWithinDays } from "@/lib/dates";
import { chunkForInQuery } from "@/lib/firestore-in";
import { Circle, Flag, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";

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
};

export default async function HomePage() {
  const { user, teams, membershipTeamIds, isAdmin, db } =
    await getUserTeamsFirebase();
  // Home aggregates data the user can open: memberships, or all teams for admin.
  const teamIds = teams.map((t) => t.id);

  // Firestore `in` caps at 30 values and each query at 30 disjunctions, so
  // every team_id list goes through chunkForInQuery (same pattern as
  // lib/scorecard-entries.ts). Chunks are empty when the user has no teams,
  // so each Promise.all resolves to [].
  const teamChunks = chunkForInQuery(teamIds);

  const [todoSnaps, rockSnaps, memberSnaps] = await Promise.all([
    // Todos: team-visible items, plus (separate query) the viewer's OWN
    // private items — mirrors the To-Dos / meeting pages so other members'
    // private to-dos never render here. The two queries are disjoint
    // (visibility differs), so a plain merge can't duplicate rows.
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
    Promise.all(
      teamChunks.map((ids) =>
        db.collection("team_members").where("team_id", "in", ids).get(),
      ),
    ),
  ]);

  // Hydrate display names for every teammate across the user's teams. One
  // batched getAll() — no per-row N+1.
  const memberUids = new Set<string>(
    memberSnaps.flatMap((s) => s.docs.map((d) => d.data().user_id as string)),
  );
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
  const rocks = rockSnaps.flatMap((snap) =>
    snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RockRow, "id">) })),
  ) as RockRow[];

  // due_date asc, nulls last
  const byDue = <T extends { due_date: string | null }>(a: T, b: T) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  };
  todos.sort(byDue);
  rocks.sort(byDue);

  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const rockTitleById = new Map(rocks.map((r) => [r.id, r.title]));

  const mineFirst = <T extends { owner_id: string | null }>(rows: T[]) =>
    [...rows].sort(
      (a, b) => Number(b.owner_id === user.id) - Number(a.owner_id === user.id),
    );

  // Split: pure to-dos (no parent rock) vs milestones (linked to a rock and
  // owned by the current user). Prevents double-counting in the to-dos section.
  const pureTodos = todos.filter((t) => !t.source_rock_id);
  const myMilestones = todos.filter(
    (t) => t.source_rock_id && t.owner_id === user.id,
  );

  // Further split milestones by due date: milestones due within 7 days (or
  // overdue) appear in Active To-Dos; others stay in Rock Milestones.
  // Use local-midnight parsing — bare `new Date("YYYY-MM-DD")` is UTC and
  // can mis-bucket near timezone edges (P0-4).
  const dueSoonMilestones = myMilestones.filter((m) =>
    isDueWithinDays(m.due_date, 7),
  );

  const futureMilestones = myMilestones.filter(
    (m) => !isDueWithinDays(m.due_date, 7),
  );

  // Combine pure todos with due-soon milestones for the Active To-Dos section
  const allActiveTodos = [...pureTodos, ...dueSoonMilestones];
  const sortedActiveTodos = mineFirst(allActiveTodos.sort(byDue));
  const sortedRocks = mineFirst(rocks);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
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

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400 mb-3">
          Active To-Dos ({sortedActiveTodos.length})
        </h2>
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {sortedActiveTodos.length === 0 && <Empty>No open to-dos.</Empty>}
          {sortedActiveTodos.map((t) => {
            const isMilestone = Boolean(t.source_rock_id);
            return (
              <Link
                key={t.id}
                href={`/teams/${t.team_id}/${isMilestone ? "rocks" : "todos"}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                {isMilestone ? (
                  <Flag className="w-4 h-4 text-zinc-500 dark:text-zinc-500" />
                ) : (
                  <Circle className="w-4 h-4 text-zinc-300" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{t.title}</div>
                  {isMilestone && (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                      {rockTitleById.get(t.source_rock_id ?? "") ?? "—"}
                    </div>
                  )}
                </div>
                {!isMilestone && (
                  <OwnerLabel
                    isMine={t.owner_id === user.id}
                    name={t.owner_id ? nameByUserId.get(t.owner_id) ?? null : null}
                  />
                )}
                <TeamLabel name={teamNameById.get(t.team_id) ?? ""} />
                <DueLabel due={t.due_date} />
              </Link>
            );
          })}
        </div>
      </section>

      {futureMilestones.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400 mb-3">
            Rock Milestones ({futureMilestones.length})
          </h2>
          <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
            {mineFirst(futureMilestones).map((m) => (
              <Link
                key={m.id}
                href={`/teams/${m.team_id}/rocks`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <Flag className="w-4 h-4 text-zinc-500 dark:text-zinc-500" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{m.title}</div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                    {rockTitleById.get(m.source_rock_id ?? "") ?? "—"}
                  </div>
                </div>
                <TeamLabel name={teamNameById.get(m.team_id) ?? ""} />
                <DueLabel due={m.due_date} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400 mb-3">
          Active Rocks ({sortedRocks.length})
        </h2>
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {sortedRocks.length === 0 && <Empty>No active rocks.</Empty>}
          {sortedRocks.map((r) => (
            <Link
              key={r.id}
              href={`/teams/${r.team_id}/rocks`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <Target className="w-4 h-4 text-zinc-500 dark:text-zinc-500" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{r.title}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {r.quarter}
                </div>
              </div>
              <OwnerLabel
                isMine={r.owner_id === user.id}
                name={r.owner_id ? nameByUserId.get(r.owner_id) ?? null : null}
              />
              <TeamLabel name={teamNameById.get(r.team_id) ?? ""} />
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState title={children} />;
}

function OwnerLabel({
  isMine,
  name,
}: {
  isMine: boolean;
  name: string | null;
}) {
  const label = isMine ? "You" : name ?? "—";
  return (
    <span
      className={
        "inline-flex items-center text-xs whitespace-nowrap " +
        (isMine
          ? "text-zinc-900 dark:text-zinc-100 font-medium"
          : "text-zinc-600 dark:text-zinc-400")
      }
    >
      {label}
    </span>
  );
}

function TeamLabel({ name }: { name: string }) {
  if (!name) return null;
  return (
    <span className="hidden md:inline-flex items-center text-xs text-zinc-500 dark:text-zinc-500 whitespace-nowrap">
      {name}
    </span>
  );
}

function DueLabel({ due }: { due: string | null }) {
  if (!due)
    return (
      <span className="text-xs text-zinc-500 dark:text-zinc-500 w-24 text-right">
        —
      </span>
    );
  // Local-midnight comparison via daysUntil — bare `new Date("YYYY-MM-DD")`
  // parses as UTC midnight and marks items due today as overdue all day in
  // US timezones.
  const overdue = daysUntil(due) < 0;
  return (
    <span
      className={
        "text-xs whitespace-nowrap w-24 text-right " +
        (overdue ? "text-red-600" : "text-zinc-600 dark:text-zinc-400")
      }
    >
      Due {formatDateOnly(due)}
    </span>
  );
}
