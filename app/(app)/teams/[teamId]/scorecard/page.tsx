import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ScorecardGrid } from "@/components/scorecard/scorecard-grid";
import { ScorecardToolbar } from "@/components/scorecard/scorecard-toolbar";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { mondayOf, toDateString, lastNMondays } from "@/lib/dates";
import { parseWeekRange, type GoalDirection } from "@/lib/scorecard";
import { addMetric } from "./actions";

type MetricDoc = {
  team_id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: GoalDirection;
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

export default async function ScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ weeks?: string }>;
}) {
  const { teamId: tid } = await params;
  const sp = await searchParams;
  const weekRange = parseWeekRange(sp.weeks);
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const metricsSnap = await db
    .collection("scorecard_metrics")
    .where("team_id", "==", tid)
    .get();

  const metrics = metricsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MetricDoc) }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const weeks = lastNMondays(weekRange).map(toDateString); // newest first
  const oldestWeek = weeks[weeks.length - 1]!;

  // Firestore `in` is capped at 30 — known limit (see ROADMAP).
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

  const entryRecord: Record<string, number | null> = {};
  entriesSnap?.docs.forEach((d) => {
    const data = d.data() as EntryDoc;
    entryRecord[`${data.metric_id}__${data.week_start_date}`] = data.value;
  });

  const groupNames = [
    ...new Set(
      metrics
        .map((m) => m.group?.trim() || "")
        .filter((g) => g !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scorecard</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Record and evaluate key metrics — weekly operating rhythm.
          </p>
        </div>
        <p className="text-xs text-zinc-500 tabular-nums">
          Current week starts{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {toDateString(mondayOf())}
          </span>
        </p>
      </header>

      <Suspense
        fallback={
          <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        }
      >
        <ScorecardToolbar weekRange={weekRange} teamLabel={team.name} />
      </Suspense>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">Weekly</h2>
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-200 px-2 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {metrics.length}
          </span>
        </div>

        {metrics.length === 0 ? (
          <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <EmptyState
              icon={BarChart3}
              title="No metrics yet"
              hint="Add your team's weekly KPIs with the form below to start tracking."
            />
          </div>
        ) : (
          <ScorecardGrid
            teamId={tid}
            weeks={weeks}
            metrics={metrics}
            entryByMetricWeek={entryRecord}
            members={members}
            showDelete
            showGroupEditor
          />
        )}
      </section>

      <AddMetricForm
        teamId={tid}
        members={members}
        defaultOwnerId={uid}
        groups={groupNames}
      />
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
      <div className="md:col-span-7 text-xs font-medium uppercase tracking-wide text-zinc-500">
        Add measurable
      </div>
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
        <option value="gte">At least (&gt;=)</option>
        <option value="lte">At most (&lt;=)</option>
        <option value="eq">Exactly (=)</option>
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
