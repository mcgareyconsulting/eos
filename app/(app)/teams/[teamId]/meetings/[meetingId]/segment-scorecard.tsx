"use client";

import { useMemo } from "react";
import { EntityViewToggle } from "@/components/entity-view-tabs";
import { useArchivedToggle } from "@/lib/l10/use-archived-toggle";
import {
  canEditMetricValues,
  isArchivedMetric,
  metricGroupForTeam,
} from "@/lib/scorecard-share";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { useScorecardEntries } from "@/lib/firebase/use-scorecard-entries";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import {
  compareGroups,
  type ScorecardGroup,
  defaultGroupName,
} from "@/lib/scorecard-groups";
import { QuickAddIssue } from "@/components/quick-add-issue";
import type { WeekRange } from "@/lib/scorecard";
import {
  buildScorecardColumns,
  oldestPeriodStart,
  type ScorecardPeriod,
  normalizeMetricInterval,
} from "@/lib/scorecard-periods";
import {
  compareBySpeakingOrder,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import {
  type ScorecardMetricDoc as ScorecardMetricDocRecord,
  type WithId,
} from "@/lib/firestore-types";

type MetricDoc = WithId<ScorecardMetricDocRecord>;

type EntryDoc = {
  id: string;
  metric_id: string;
  week_start_date: string;
  value: number | null;
};

type Member = { user_id: string; full_name: string };

export function SegmentScorecard({
  teamId,
  meetingId,
  weekRange,
  period = "weekly",
  initialMetrics,
  initialEntries,
  initialGroups,
  members,
  speakingOrder: speakingOrderProp,
  absentUserIds = [],
  isAdmin = false,
  teamNameById = {},
  ownerNameById = {},
}: {
  teamId: string;
  meetingId: string;
  weekRange: WeekRange;
  /** Weekly / monthly / quarterly / annual — same as standalone scorecard. */
  period?: ScorecardPeriod;
  initialMetrics: MetricDoc[];
  initialEntries: EntryDoc[];
  /** Seeded from the server so group order never flashes alphabetical. */
  initialGroups: ScorecardGroup[];
  members: Member[];
  /** Meeting/team speaking order — drives Default order. */
  speakingOrder?: string[];
  absentUserIds?: string[];
  /** Org admins may log values on a borrowed measurable; nobody else may. */
  isAdmin?: boolean;
  /**
   * Team id → name, and uid → display name, for labelling borrowed rows.
   *
   * Both come from the server because the client cannot resolve either: it
   * subscribes to measurables, not to teams or `/users`, and a borrowed row's
   * owner sits on a roster this meeting never loads. A measurable shared into
   * the team *during* the meeting therefore arrives live but unlabelled until
   * the next full load — the row and its numbers are right, only the "Shared
   * from" name is missing, which is a better trade than two more listeners.
   */
  teamNameById?: Record<string, string>;
  ownerNameById?: Record<string, string>;
}) {
  const db = getClientDb();

  // Two subscriptions, because Firestore cannot OR `team_id ==` with
  // `shared_team_ids array-contains`. The seed is split the same way so each
  // listener starts from the rows it owns rather than re-rendering the whole
  // grid on first snapshot.
  const ownedQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "scorecard_metrics"),
        where("team_id", "==", teamId),
      ),
    [db, teamId],
  );
  const sharedQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "scorecard_metrics"),
        where("shared_team_ids", "array-contains", teamId),
      ),
    [db, teamId],
  );
  const initialOwned = useMemo(
    () => initialMetrics.filter((m) => m.team_id === teamId),
    [initialMetrics, teamId],
  );
  const initialShared = useMemo(
    () => initialMetrics.filter((m) => m.team_id !== teamId),
    [initialMetrics, teamId],
  );
  const owned = useCollection<MetricDoc>(ownedQuery, initialOwned);
  const sharedIn = useCollection<MetricDoc>(sharedQuery, initialShared);

  // Local state, not the URL — the same reasoning as every other segment:
  // this page already owns `?view=`, `?recap=1`, `?weeks=` and `?period=`, and
  // follow-the-leader's `router.replace(pathname)` would reset a viewer's
  // Archived view mid-meeting. Resets on unmount, because Active is the right
  // default for a room.
  const [showArchived, setShowArchived] = useArchivedToggle();

  const allMetrics = useMemo(() => {
    const byId = new Map<string, MetricDoc>();
    for (const m of [...owned, ...sharedIn]) {
      if (!byId.has(m.id)) byId.set(m.id, m);
    }
    return [...byId.values()]
      .map((m) => {
        const borrowed = m.team_id !== teamId;
        const interval = m.interval ?? "weekly";
        return {
          ...m,
          group: metricGroupForTeam(m, teamId),
          sharedFrom: borrowed
            ? (teamNameById[m.team_id] ?? "Another team")
            : null,
          ownerName: ownerNameById[m.owner_id ?? ""] ?? null,
          canEditValues: canEditMetricValues({
            metric: m,
            teamId,
            isAdmin,
          }),
          sectionName:
            metricGroupForTeam(m, teamId) ??
            defaultGroupName(normalizeMetricInterval(interval)),
          isArchived: isArchivedMetric(m),
        };
      });
  }, [owned, sharedIn, teamId, teamNameById, ownerNameById, isAdmin]);

  // Counted across both views so the toggle's numbers hold steady, the same
  // way the standalone tabs count regardless of the period tab.
  const activeCount = useMemo(
    () => allMetrics.filter((m) => !m.isArchived).length,
    [allMetrics],
  );
  const archivedCount = allMetrics.length - activeCount;

  const metrics = useMemo(
    () => allMetrics.filter((m) => m.isArchived === showArchived),
    [allMetrics, showArchived],
  );
  // Live too: reordering groups on the Scorecard tab mid-meeting should
  // land in the room without a refresh, same as a metric edit does.
  const groupsQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "scorecard_groups"),
        where("team_id", "==", teamId),
      ),
    [db, teamId],
  );
  const groupsLive = useCollection<ScorecardGroup>(groupsQuery, initialGroups);
  const groups = useMemo(
    () => [...groupsLive].sort(compareGroups),
    [groupsLive],
  );

  const metricIds = useMemo(() => metrics.map((m) => m.id), [metrics]);
  // Load far enough back for the active interval (annual = multi-year).
  const oldest = useMemo(
    () => oldestPeriodStart(period, weekRange),
    [period, weekRange],
  );

  // Chunks past the 30-value `in` limit so large scorecards stay live.
  const entries = useScorecardEntries(metricIds, oldest, initialEntries);

  const entryRecord = useMemo(() => {
    const rec: Record<string, number | null> = {};
    for (const e of entries) {
      rec[`${e.metric_id}__${e.week_start_date}`] = e.value;
    }
    return rec;
  }, [entries]);

  const speakingOrder = useMemo(
    () => reconcileSpeakingOrder(speakingOrderProp, members),
    [speakingOrderProp, members],
  );

  const sorted = useMemo(
    () =>
      [...metrics].sort((a, b) =>
        compareBySpeakingOrder(a, b, speakingOrder, absentUserIds),
      ),
    [metrics, speakingOrder, absentUserIds],
  );

  const columns = useMemo(
    () => buildScorecardColumns(period, undefined, weekRange),
    [period, weekRange],
  );

  // An unconfigured team gets a plain pointer instead of the full filter
  // shell wrapped around an empty table — metrics are set up on the
  // Scorecard tab, not mid-meeting.
  // Only bail out when the team has nothing at all. An empty *Archived* view
  // must keep the toggle on screen, or the only way back to Active is to leave
  // the segment.
  if (allMetrics.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        No measurables yet — set up the scorecard on the Scorecard tab before
        the meeting.
      </div>
    );
  }

  return (
    <ScorecardPanel
      teamId={teamId}
      period={period}
      weekRange={weekRange}
      columns={columns}
      metrics={sorted}
      entryByMetricWeek={entryRecord}
      members={members}
      showManage={false}
      groups={groups}
      compact
      speakingOrder={speakingOrder}
      absentUserIds={absentUserIds}
      toolbarExtra={
        <>
          {/* Same control and same slot order as the other segments: the
              view toggle sits left of the segment's add action. */}
          <EntityViewToggle
            showArchived={showArchived}
            onChange={setShowArchived}
            activeCount={activeCount}
            archivedCount={archivedCount}
          />
          <QuickAddIssue
            teamId={teamId}
            prefill="Off-track metric: "
            meetingId={meetingId}
          />
        </>
      }
    />
  );
}
