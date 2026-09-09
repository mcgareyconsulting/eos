import { Suspense } from "react";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import {
  requireTeamAccess,
  getTeamMembers,
  getOrgTeams,
} from "@/lib/firebase/teams";
import { loadUserNames } from "@/lib/firebase/user-names";
import {
  canArchiveMetric,
  canEditMetricValues,
  isArchivedMetric,
  metricGroupForTeam,
} from "@/lib/scorecard-share";
import { defaultGroupName } from "@/lib/scorecard-groups";
import { normalizeMetricInterval } from "@/lib/scorecard-periods";
import Link from "next/link";
import { Archive } from "lucide-react";
import { loadScorecardGroups } from "@/lib/firebase/scorecard-groups";
import { parseWeekRange } from "@/lib/scorecard";
import {
  entriesToRecord,
  loadScorecardEntries,
} from "@/lib/scorecard-entries";
import {
  buildScorecardColumns,
  oldestPeriodStart,
  parseScorecardPeriod,
} from "@/lib/scorecard-periods";
import { AddMeasurableMenu } from "./add-measurable-menu";
import { ManageGroupsButton } from "./manage-groups";
import { type ScorecardMetricDoc as MetricDoc } from "@/lib/firestore-types";

export default async function ScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ weeks?: string; period?: string; archived?: string }>;
}) {
  const { teamId: tid } = await params;
  const sp = await searchParams;
  const weekRange = parseWeekRange(sp.weeks);
  const period = parseScorecardPeriod(sp.period);
  const showArchived = sp.archived === "1";
  const { uid, db, team, isAdmin } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  // Two queries, not one: Firestore cannot OR `team_id == tid` with
  // `shared_team_ids array-contains tid`, so the team's own measurables and
  // the ones it has borrowed are fetched separately and merged. Both are
  // single-field queries, so neither needs a composite index.
  const [ownedSnap, sharedSnap, orgTeams] = await Promise.all([
    db.collection("scorecard_metrics").where("team_id", "==", tid).get(),
    db
      .collection("scorecard_metrics")
      .where("shared_team_ids", "array-contains", tid)
      .get(),
    getOrgTeams(),
  ]);

  const groups = await loadScorecardGroups(db, tid);

  const teamName = new Map(orgTeams.map((t) => [t.id, t.name]));


  // Dedupe by id. A document could in principle answer both queries — its own
  // team id sitting in its own share array — and rendering that row twice
  // would be a confusing way to surface a data bug.
  const byId = new Map<string, MetricDoc & { id: string }>();
  for (const d of [...ownedSnap.docs, ...sharedSnap.docs]) {
    if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...(d.data() as MetricDoc) });
  }
  // Borrowed measurables are owned by someone on the home team, who is not on
  // this team's roster — so the grid's roster lookup misses and the row shows
  // "—". Resolve exactly those from /users; the roster already answers for
  // everyone else.
  const rosterIds = new Set(members.map((m) => m.user_id));
  const offRosterOwners = [...byId.values()]
    .map((x) => String(x.owner_id ?? ""))
    .filter((id) => id !== "" && !rosterIds.has(id));
  const resolvedOwner = await loadUserNames(db, offRosterOwners);

  // Archived rows are hidden by default and shown alone under ?archived=1 —
  // not mixed in. A greyed row interleaved with live ones still occupies a
  // line in the grid and still reads as something the team is tracking, which
  // is exactly what archiving it was meant to stop.
  const archivedCount = [...byId.values()].filter((x) =>
    isArchivedMetric(x),
  ).length;

  const metrics = [...byId.values()]
    .filter((x) => isArchivedMetric(x) === showArchived)
    .map((x) => {
      const home = String(x.team_id ?? tid);
      const borrowed = home !== tid;
      return {
        id: x.id,
        name: x.name,
        unit: x.unit,
        goal: x.goal ?? null,
        direction: x.direction,
        owner_id: x.owner_id ?? null,
        // The group as *this* team stores it — its own for a borrowed row —
        // which is what the inline editor edits. `sectionName` below is the
        // one that decides which header the row renders under.
        group: metricGroupForTeam({ ...x, team_id: home }, tid),
        interval: x.interval ?? "weekly",
        sectionName:
          metricGroupForTeam({ ...x, team_id: home }, tid) ??
          defaultGroupName(normalizeMetricInterval(x.interval)),
        sort_order: x.sort_order ?? 0,
        team_id: home,
        sharedFrom: borrowed ? (teamName.get(home) ?? "Another team") : null,
        ownerName: resolvedOwner.get(String(x.owner_id ?? "")) ?? null,
        canEditValues: canEditMetricValues({
          metric: { team_id: home, shared_team_ids: x.shared_team_ids },
          teamId: tid,
          isAdmin,
        }),
        // Archive and delete share one gate, so one flag drives both controls.
        canManage: canArchiveMetric({
          metric: {
            team_id: home,
            shared_team_ids: x.shared_team_ids,
            owner_id: x.owner_id ?? null,
          },
          teamId: tid,
          uid,
          isAdmin,
        }),
        isArchived: isArchivedMetric(x),
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

  // Suggestions for the Add-measurable picker: defined groups first, in their
  // configured order, then any label still only living on a metric. Without
  // the group docs a group created but not yet used would be missing from the
  // very picker meant to assign it.
  const groupNames = [
    ...new Set([
      ...groups.map((g) => g.name),
      ...metrics.map((m) => m.group?.trim() || "").filter((g) => g !== ""),
    ]),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {showArchived ? "Archived measurables" : "Scorecard"}
          </h1>
          {showArchived && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Hidden from the scorecard, with every logged value kept. Restore
              one to put it back.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(archivedCount > 0 || showArchived) && (
            <Link
              href={
                showArchived
                  ? `/teams/${tid}/scorecard?period=${period}`
                  : `/teams/${tid}/scorecard?period=${period}&archived=1`
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Archive className="h-4 w-4" aria-hidden />
              {showArchived ? "Back to scorecard" : `Archived (${archivedCount})`}
            </Link>
          )}
          <ManageGroupsButton
            teamId={tid}
            groups={groups}
            activePeriod={period}
          />
          <AddMeasurableMenu
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
          viewerId={uid}
          teamLabel={team.name}
          period={period}
          weekRange={weekRange}
          columns={columns}
          metrics={metrics}
          entryByMetricWeek={entryRecord}
          members={members}
          showManage
          groups={groups}
        />
      </Suspense>
    </div>
  );
}
