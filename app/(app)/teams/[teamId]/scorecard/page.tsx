import { requireTeamAccess, getTeamMembers, onTrack } from "@/lib/teams";
import { lastNMondays, toDateString } from "@/lib/dates";
import { ValueCell } from "./value-cell";
import { addMetric, deleteMetric } from "./actions";
import { Trash2 } from "lucide-react";

export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { supabase, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const weeks = lastNMondays(13).map(toDateString); // newest first

  const { data: metrics } = await supabase
    .from("scorecard_metrics")
    .select("id, name, unit, goal, direction, owner_id, sort_order")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true });

  const metricIds = (metrics ?? []).map((m) => m.id);
  const { data: entries } = await supabase
    .from("scorecard_entries")
    .select("metric_id, week_start_date, value")
    .in("metric_id", metricIds.length ? metricIds : ["00000000-0000-0000-0000-000000000000"])
    .gte("week_start_date", weeks[weeks.length - 1]);

  const entryByKey = new Map<string, number>();
  for (const e of entries ?? []) {
    entryByKey.set(`${e.metric_id}|${e.week_start_date}`, Number(e.value));
  }

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scorecard</h1>
          <p className="mt-1 text-sm text-zinc-500">{team.name}</p>
        </div>
      </header>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="text-left font-medium text-zinc-600 px-4 py-2 sticky left-0 bg-zinc-50">
                Metric
              </th>
              <th className="text-left font-medium text-zinc-600 px-3 py-2">
                Owner
              </th>
              <th className="text-right font-medium text-zinc-600 px-3 py-2">
                Goal
              </th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className="text-right font-medium text-zinc-500 px-2 py-2 whitespace-nowrap"
                >
                  {formatWeek(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(metrics ?? []).map((m) => {
              const remove = deleteMetric.bind(null, teamId, m.id);
              return (
              <tr key={m.id} className="group border-b border-zinc-100 last:border-0">
                <td className="px-4 py-2 sticky left-0 bg-white font-medium">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{m.name}</span>
                    <form action={remove}>
                      <button
                        type="submit"
                        className="text-zinc-300 hover:text-red-600 opacity-0 group-hover:opacity-100"
                        aria-label="Delete metric"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </form>
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {ownerName(m.owner_id)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-600 tabular-nums">
                  {formatGoal(m.goal, m.direction, m.unit)}
                </td>
                {weeks.map((w, i) => {
                  const val = entryByKey.get(`${m.id}|${w}`) ?? null;
                  const ok = onTrack(val, m.goal, m.direction as "gte" | "lte" | "eq");
                  return (
                    <td key={w} className="px-1 py-1 min-w-20">
                      <ValueCell
                        teamId={teamId}
                        metricId={m.id}
                        weekStart={w}
                        initialValue={val}
                        onTrack={ok}
                        unit={m.unit}
                        readOnly={i > 0}
                      />
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {(metrics ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={3 + weeks.length}
                  className="px-4 py-8 text-center text-zinc-500"
                >
                  No metrics yet. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AddMetricForm teamId={teamId} members={members} />
    </div>
  );
}

function formatWeek(d: string): string {
  const date = new Date(d + "T00:00:00");
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatGoal(
  goal: number | null,
  direction: string,
  unit: string,
): string {
  if (goal == null) return "—";
  const arrow = direction === "gte" ? "≥" : direction === "lte" ? "≤" : "=";
  if (unit === "currency") return `${arrow} $${goal.toLocaleString()}`;
  if (unit === "percent") return `${arrow} ${goal}%`;
  return `${arrow} ${goal.toLocaleString()}`;
}

function AddMetricForm({
  teamId,
  members,
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
}) {
  async function action(formData: FormData) {
    "use server";
    await addMetric(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-200 bg-white p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="name"
        placeholder="Metric name"
        required
        className="md:col-span-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <select
        name="unit"
        defaultValue="number"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="number">Number</option>
        <option value="currency">Currency</option>
        <option value="percent">Percent</option>
        <option value="time">Time</option>
        <option value="yesno">Yes/No</option>
      </select>
      <select
        name="direction"
        defaultValue="gte"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="gte">≥ goal</option>
        <option value="lte">≤ goal</option>
        <option value="eq">= goal</option>
      </select>
      <input
        name="goal"
        type="number"
        step="any"
        placeholder="Goal"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <select
        name="owner_id"
        defaultValue=""
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">— owner —</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Add metric
      </button>
    </form>
  );
}
