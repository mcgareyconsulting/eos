import Link from "next/link";
import { getUserTeams } from "@/lib/auth";
import { getTeamMembers } from "@/lib/teams";
import { CheckCircle2, Circle, Target } from "lucide-react";

export default async function My90Page() {
  const { user, supabase, teams } = await getUserTeams();
  const teamIds = teams.map((t) => t.id);

  // Open to-dos across all my teams (team-visible items + my private ones).
  const { data: todos } =
    teamIds.length === 0
      ? { data: [] as TodoRow[] }
      : await supabase
          .from("todos")
          .select(
            "id, title, due_date, team_id, owner_id, visibility, completed_at",
          )
          .in("team_id", teamIds)
          .is("completed_at", null)
          .order("due_date", { ascending: true, nullsFirst: false });

  // Active rocks across all my teams.
  const { data: rocks } =
    teamIds.length === 0
      ? { data: [] as RockRow[] }
      : await supabase
          .from("rocks")
          .select("id, title, status, due_date, quarter, owner_id, team_id")
          .in("team_id", teamIds)
          .not("status", "in", "(done,cancelled)")
          .order("due_date", { ascending: true, nullsFirst: false });

  // Names for the owner labels (one query across all teams).
  const memberLists = await Promise.all(teamIds.map((id) => getTeamMembers(id)));
  const nameById = new Map<string, string>();
  for (const list of memberLists) {
    for (const m of list) nameById.set(m.user_id, m.full_name);
  }
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const mineFirst = <T extends { owner_id: string | null }>(rows: T[]) =>
    [...rows].sort(
      (a, b) =>
        Number(b.owner_id === user.id) - Number(a.owner_id === user.id),
    );

  const sortedTodos = mineFirst(todos ?? []);
  const sortedRocks = mineFirst(rocks ?? []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My 90</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Open to-dos and active rocks across {teams.length}{" "}
          {teams.length === 1 ? "team" : "teams"}.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
          Active To-Dos ({sortedTodos.length})
        </h2>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {sortedTodos.length === 0 && <Empty>No open to-dos.</Empty>}
          {sortedTodos.map((t) => (
            <Link
              key={t.id}
              href={`/teams/${t.team_id}/todos`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <Circle className="w-4 h-4 text-zinc-300" />
              <div className="flex-1 min-w-0 truncate">{t.title}</div>
              <OwnerLabel
                isMine={t.owner_id === user.id}
                name={t.owner_id ? nameById.get(t.owner_id) ?? "—" : "unassigned"}
              />
              <TeamLabel name={teamNameById.get(t.team_id) ?? ""} />
              <DueLabel due={t.due_date} />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
          Active Rocks ({sortedRocks.length})
        </h2>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {sortedRocks.length === 0 && <Empty>No active rocks.</Empty>}
          {sortedRocks.map((r) => (
            <Link
              key={r.id}
              href={`/teams/${r.team_id}/rocks`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <Target className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{r.title}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.quarter}</div>
              </div>
              <OwnerLabel
                isMine={r.owner_id === user.id}
                name={r.owner_id ? nameById.get(r.owner_id) ?? "—" : "unassigned"}
              />
              <TeamLabel name={teamNameById.get(r.team_id) ?? ""} />
              <StatusPill status={r.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

type TodoRow = {
  id: string;
  title: string;
  due_date: string | null;
  team_id: string;
  owner_id: string | null;
  visibility: string;
  completed_at: string | null;
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

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>;
}

function OwnerLabel({ isMine, name }: { isMine: boolean; name: string }) {
  return (
    <span
      className={
        "inline-flex items-center text-xs whitespace-nowrap " +
        (isMine ? "text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-500 dark:text-zinc-400")
      }
    >
      {isMine ? "You" : name}
    </span>
  );
}

function TeamLabel({ name }: { name: string }) {
  if (!name) return null;
  return (
    <span className="hidden md:inline-flex items-center text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
      {name}
    </span>
  );
}

function DueLabel({ due }: { due: string | null }) {
  if (!due) return <span className="text-xs text-zinc-400 dark:text-zinc-500 w-24 text-right">—</span>;
  const overdue = new Date(due) < new Date(new Date().toDateString());
  return (
    <span
      className={
        "text-xs whitespace-nowrap w-24 text-right " +
        (overdue ? "text-red-600" : "text-zinc-500 dark:text-zinc-400")
      }
    >
      Due {new Date(due).toLocaleDateString()}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    on_track: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 ring-emerald-200",
    off_track: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200",
    done: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-zinc-200",
    cancelled: "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 ring-zinc-200",
  };
  const label = status.replace("_", " ");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
        styles[status] ?? styles.on_track
      }`}
    >
      {status === "done" && <CheckCircle2 className="w-3 h-3" />}
      {label}
    </span>
  );
}
