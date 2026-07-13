import { Trash2, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { mondayOf, toDateString, lastNMondays, formatWeekLabel } from "@/lib/dates";
import { formatGoal, formatValue } from "@/lib/scorecard";
import { ValueCell } from "./value-cell";
import { GroupCell } from "./group-cell";
import { addMetric, deleteMetric } from "./actions";

type MetricDoc = {
  team_id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: "gte" | "lte" | "eq";
  owner_id: string | null;
  sort_order: number;
  // Optional ninety.io-style section label ("Deposit and Loan Volume", etc).
  // Absent on metrics created before grouping existed — treat missing/empty
  // as ungrouped, not as an error.
  group?: string | null;
};

type EntryDoc = {
  metric_id: string;
  week_start_date: string;
  value: number | null;
  note: string | null;
};

// Client's stated standard (mirrors ninety.io's 13-week trend view).
const WEEKS = 13;

function onTrack(
  value: number | null,
  goal: number | null,
  direction: "gte" | "lte" | "eq",
): boolean | null {
  if (value == null || goal == null) return null;
  if (direction === "gte") return value >= goal;
  if (direction === "lte") return value <= goal;
  return value === goal;
}

// Average of recorded weeks only — empty weeks don't drag the average down.
function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const metricsSnap = await db
    .collection("scorecard_metrics")
    .where("team_id", "==", tid)
    .get();

  const metrics = metricsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MetricDoc) }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const weeks = lastNMondays(WEEKS).map(toDateString); // newest first
  const oldestWeek = weeks[weeks.length - 1];

  const entriesSnap = metrics.length
    ? await db
        .collection("scorecard_entries")
        .where(
          "metric_id",
          "in",
          metrics.map((m) => m.id).slice(0, 30),
        )
        .where("week_start_date", ">=", oldestWeek)
        .get()
    : null;

  const entryByMetricWeek = new Map<string, number | null>();
  entriesSnap?.docs.forEach((d) => {
    const data = d.data() as EntryDoc;
    entryByMetricWeek.set(`${data.metric_id}__${data.week_start_date}`, data.value);
  });

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  const totalCols = 4 + weeks.length + 1;

  // Bucket metrics by section (ninety.io calls these "sections", e.g.
  // "Deposit and Loan Volume"). Metrics without a group — including every
  // metric created before this field existed — land in the "" bucket and
  // render first, headerless, so ungrouped scorecards look unchanged.
  const groupedMetrics = new Map<string, typeof metrics>();
  for (const m of metrics) {
    const key = m.group?.trim() || "";
    const bucket = groupedMetrics.get(key);
    if (bucket) bucket.push(m);
    else groupedMetrics.set(key, [m]);
  }
  const ungrouped = groupedMetrics.get("") ?? [];
  const groupNames = [...groupedMetrics.keys()]
    .filter((g) => g !== "")
    .sort((a, b) => a.localeCompare(b));

  const renderMetricRow = (m: (typeof metrics)[number]) => {
    const remove = deleteMetric.bind(null, tid, m.id);
    const values = weeks.map(
      (w) => entryByMetricWeek.get(`${m.id}__${w}`) ?? null,
    );
    const avg = average(values);
    const avgOnTrack = onTrack(avg, m.goal, m.direction);
    const avgColor =
      avgOnTrack == null
        ? "text-zinc-600 dark:text-zinc-400"
        : avgOnTrack
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-red-700 dark:text-red-300";
    return (
      <tr
        key={m.id}
        className="group border-b border-zinc-200 dark:border-zinc-800 last:border-0"
      >
        <td className="px-4 py-2 font-medium">
          <div>{m.name}</div>
          <GroupCell teamId={tid} metricId={m.id} initial={m.group ?? null} />
        </td>
        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
          {ownerName(m.owner_id)}
        </td>
        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 tabular-nums">
          {formatGoal(m.goal, m.direction, m.unit)}
        </td>
        <td
          className={`px-2 py-2 text-right font-medium tabular-nums ${avgColor}`}
          title={
            avg == null
              ? "No entries yet"
              : `Average of ${values.filter((v) => v != null).length} recorded weeks`
          }
        >
          {formatValue(avg, m.unit)}
        </td>
        {weeks.map((w, i) => {
          const v = values[i];
          return (
            <td key={w} className="px-1 py-1">
              <ValueCell
                teamId={tid}
                metricId={m.id}
                weekStartDate={w}
                initial={v}
                onTrack={onTrack(v, m.goal, m.direction)}
              />
            </td>
          );
        })}
        <td className="px-2 py-2 text-right">
          <form action={remove}>
            <button
              type="submit"
              className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
              aria-label="Delete metric"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </form>
        </td>
      </tr>
    );
  };

  const renderGroupHeader = (g: string) => (
    <tr key={`group-${g}`} className="bg-zinc-50 dark:bg-zinc-950/40">
      <td
        colSpan={totalCols}
        className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        {g}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Scorecard</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.name} · last {WEEKS} weeks (Mondays)
        </p>
      </header>

      <AddMetricForm
        teamId={tid}
        members={members}
        defaultOwnerId={uid}
        groups={groupNames}
      />

      <div className="overflow-x-auto rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Metric</th>
              <th className="text-left px-4 py-2 font-medium">Owner</th>
              <th className="text-left px-4 py-2 font-medium">Goal</th>
              <th className="text-right px-2 py-2 font-medium">Avg</th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className="text-right px-2 py-2 font-medium tabular-nums"
                >
                  {formatWeekLabel(w)}
                </th>
              ))}
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {metrics.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="p-0">
                  <EmptyState
                    icon={BarChart3}
                    title="No metrics yet"
                    hint="Add your team's weekly KPIs with the form above to start tracking."
                  />
                </td>
              </tr>
            )}
            {ungrouped.map(renderMetricRow)}
            {groupNames.flatMap((g) => [
              renderGroupHeader(g),
              ...groupedMetrics.get(g)!.map(renderMetricRow),
            ])}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        Current week:{" "}
        <span className="tabular-nums">{toDateString(mondayOf())}</span>
      </p>
    </div>
  );
}

function AddMetricForm({
  teamId,
  members,
  defaultOwnerId,
  groups,
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
  defaultOwnerId: string;
  groups: string[];
}) {
  async function action(formData: FormData) {
    "use server";
    await addMetric(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-7 gap-3"
    >
      <input
        name="name"
        placeholder="Metric name"
        required
        className="md:col-span-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <select
        name="unit"
        defaultValue="number"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="number">Number</option>
        <option value="currency">Currency</option>
        <option value="percent">Percent</option>
        <option value="yesno">Yes/No</option>
        <option value="time">Time</option>
      </select>
      <select
        name="direction"
        defaultValue="gte"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
        aria-label="Goal comparison"
      >
        <option value="gte">At least</option>
        <option value="lte">At most</option>
        <option value="eq">Exactly</option>
      </select>
      <input
        name="goal"
        type="number"
        step="any"
        placeholder="Goal"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      />
      <select
        name="owner_id"
        defaultValue={defaultOwnerId}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
      </select>
      <input
        name="group"
        list="scorecard-groups"
        placeholder="Section (optional)"
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <datalist id="scorecard-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <button
        type="submit"
        className="md:col-span-7 md:justify-self-end rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Add metric
      </button>
    </form>
  );
}
