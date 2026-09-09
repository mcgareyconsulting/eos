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
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { EntityPageHeader } from "@/components/entity-page-header";
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
  // Both counts, because the tabs name them. They are deliberately counted
  // across every interval rather than the active tab's: the tab bar sits above
  // the period tabs and switching Weekly/Monthly must not make the Archived
  // count jump, which would read as rows appearing and disappearing.
  const all = [...byId.values()];
  const archivedCount = all.filter((x) => isArchivedMetric(x)).length;
  const activeCount = all.length - archivedCount;

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
      {/* The same header component the other entity pages use, so the column
          order — filter, then Active|Archived, then Add — and the pixels each
          lands on are shared rather than re-derived here. Rolling its own was
          how this page ended up with the tabs to the *left* of Groups while
          every other page had them to the right. */}
      <EntityPageHeader
        title="Scorecard"
        filter={
          // Right-aligned in its column so it sits against the tabs. The other
          // pages fill this slot with a full-width select; a narrower button
          // left-aligned would leave a gap that reads as a missing control.
          <div className="flex justify-end">
            <ManageGroupsButton
              teamId={tid}
              groups={groups}
              activePeriod={period}
            />
          </div>
        }
        tabs={
          <EntityViewTabs
            basePath={`/teams/${tid}/scorecard`}
            showArchived={showArchived}
            activeCount={activeCount}
            archivedCount={archivedCount}
            // Carry the period across, or switching views silently drops you
            // back to Weekly and the row you wanted looks like it vanished.
            params={{ period, weeks: sp.weeks }}
          />
        }
        add={
          <AddMeasurableMenu
            teamId={tid}
            members={members}
            defaultOwnerId={uid}
            groups={groupNames}
            activePeriod={period}
          />
        }
      />

      {showArchived && (
        <p className="-mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Archived measurables are hidden from the scorecard, with every logged
          value kept. Restore one to put it back.
        </p>
      )}

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
