import { Suspense } from "react";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { loadScorecardGroups } from "@/lib/firebase/scorecard-groups";
import { parseWeekRange, type GoalDirection } from "@/lib/scorecard";
import {
  entriesToRecord,
  loadScorecardEntries,
} from "@/lib/scorecard-entries";
import {
  buildScorecardColumns,
  oldestPeriodStart,
  parseScorecardPeriod,
} from "@/lib/scorecard-periods";
import { AddMetricModal } from "./add-metric-modal";
import { ManageGroupsButton } from "./manage-groups";

type MetricDoc = {
  team_id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  group?: string | null;
  interval?: string | null;
};

export default async function ScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ weeks?: string; period?: string }>;
}) {
  const { teamId: tid } = await params;
  const sp = await searchParams;
  const weekRange = parseWeekRange(sp.weeks);
  const period = parseScorecardPeriod(sp.period);
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const metricsSnap = await db
    .collection("scorecard_metrics")
    .where("team_id", "==", tid)
    .get();

  const groups = await loadScorecardGroups(db, tid);

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
        interval: x.interval ?? "weekly",
        sort_order: x.sort_order ?? 0,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const columns = buildScorecardColumns(period, undefined, weekRange);
  const oldest = oldestPeriodStart(period, weekRange);

  const entryRecord = entriesToRecord(
    await loadScorecardEntries(
      db,
      metrics.map((m) => m.id),
      oldest,
    ),
  );

  // Suggestions for the Add-measurable picker: defined categories first, in
  // their configured order, then any label still only living on a metric.
  // Without the group docs a category created but not yet used would be
  // missing from the very picker meant to assign it.
  const groupNames = [
    ...new Set([
      ...groups.map((g) => g.name),
      ...metrics.map((m) => m.group?.trim() || "").filter((g) => g !== ""),
    ]),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Scorecard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ManageGroupsButton
            teamId={tid}
            groups={groups}
            activePeriod={period}
          />
          <AddMetricModal
            teamId={tid}
            members={members}
            defaultOwnerId={uid}
            groups={groupNames}
            activePeriod={period}
          />
        </div>
      </header>

      <Suspense
        fallback={
          <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        }
      >
        <ScorecardPanel
          teamId={tid}
          teamLabel={team.name}
          period={period}
          weekRange={weekRange}
          columns={columns}
          metrics={metrics}
          entryByMetricWeek={entryRecord}
          members={members}
          showDelete
          showGroupEditor
          groups={groups}
        />
      </Suspense>
    </div>
  );
}
