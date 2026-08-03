import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { mondayOf, toDateString, lastNMondays } from "@/lib/dates";
import { parseWeekRange, type GoalDirection } from "@/lib/scorecard";
import {
  entriesToRecord,
  loadScorecardEntries,
} from "@/lib/scorecard-entries";
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

  // Project explicitly rather than spreading the raw doc: imported metrics
  // carry extra fields (created_at is a Firestore Timestamp) that are not
  // serializable across the server/client boundary and crash the render.
  const metrics = metricsSnap.docs
    .map((d) => {
      const x = d.data() as MetricDoc;
      return {
        id: d.id,
        name: x.name,
        unit: x.unit,
        goal: x.goal ?? null,
        direction: x.direction,
        owner_id: x.owner_id ?? null,
        group: x.group ?? null,
        sort_order: x.sort_order ?? 0,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const weeks = lastNMondays(weekRange).map(toDateString); // newest first
  const oldestWeek = weeks[weeks.length - 1]!;

  // Chunks past Firestore's 30-value `in` limit so metric 31+ still load
  // values (previously silent all-dash rows — client "scorecard visibility").
  const entryRecord = entriesToRecord(
    await loadScorecardEntries(
      db,
      metrics.map((m) => m.id),
      oldestWeek,
    ),
  );

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

      {metrics.length === 0 ? (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <EmptyState
            icon={BarChart3}
            title="No metrics yet"
            hint="Add your team's weekly KPIs with the form below to start tracking."
          />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          }
        >
          <ScorecardPanel
            teamId={tid}
            teamLabel={team.name}
            weekRange={weekRange}
            weeks={weeks}
            metrics={metrics}
            entryByMetricWeek={entryRecord}
            members={members}
            showDelete
            showGroupEditor
          />
        </Suspense>
      )}

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
