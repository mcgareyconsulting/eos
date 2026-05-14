import { getUserTeams } from "@/lib/auth";
import { CheckCircle2, Circle, Target } from "lucide-react";

export default async function My90Page() {
  const { user, supabase, teams } = await getUserTeams();

  // My open to-dos across all my teams
  const { data: todos } = await supabase
    .from("todos")
    .select("id, title, due_date, team_id, completed_at")
    .eq("owner_id", user.id)
    .is("completed_at", null)
    .order("due_date", { ascending: true });

  // My rocks this quarter
  const { data: rocks } = await supabase
    .from("rocks")
    .select("id, title, status, due_date, quarter")
    .eq("owner_id", user.id)
    .neq("status", "done")
    .neq("status", "cancelled")
    .order("due_date", { ascending: true });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My 90</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your to-dos, rocks, and metrics across {teams.length}{" "}
          {teams.length === 1 ? "team" : "teams"}.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 mb-3">
          My To-Dos ({todos?.length ?? 0})
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
          {(todos ?? []).length === 0 && (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No open to-dos. Nice.
            </div>
          )}
          {(todos ?? []).map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <Circle className="w-4 h-4 text-zinc-300" />
              <div className="flex-1">{t.title}</div>
              {t.due_date && (
                <div className="text-xs text-zinc-500">
                  Due {new Date(t.due_date).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 mb-3">
          My Rocks ({rocks?.length ?? 0})
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
          {(rocks ?? []).length === 0 && (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No active rocks assigned to you.
            </div>
          )}
          {(rocks ?? []).map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <Target className="w-4 h-4 text-zinc-400" />
              <div className="flex-1">
                <div>{r.title}</div>
                <div className="text-xs text-zinc-500">{r.quarter}</div>
              </div>
              <StatusPill status={r.status} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    on_track: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    off_track: "bg-amber-50 text-amber-700 ring-amber-200",
    done: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    cancelled: "bg-zinc-50 text-zinc-500 ring-zinc-200",
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
