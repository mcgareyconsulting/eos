"use client";

import { useMemo } from "react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { useScorecardEntries } from "@/lib/firebase/use-scorecard-entries";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import {
  compareGroups,
  type ScorecardGroup,
} from "@/lib/scorecard-groups";
import { QuickAddIssue } from "@/components/quick-add-issue";
import type { GoalDirection, WeekRange } from "@/lib/scorecard";
import {
  buildScorecardColumns,
  oldestPeriodStart,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import {
  compareBySpeakingOrder,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";

type MetricDoc = {
  id: string;
  team_id: string;
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  // Optional section label — see scorecard/page.tsx. Missing on metrics
  // created before grouping existed, and on the SSR-serialized
  // `initialMetrics` until the realtime listener below replaces it.
  group?: string | null;
  interval?: string | null;
};

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
  /** Meeting/team speaking order — drives Default order (P1-4). */
  speakingOrder?: string[];
  absentUserIds?: string[];
}) {
  const db = getClientDb();

  const metricsQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "scorecard_metrics"),
        where("team_id", "==", teamId),
      ),
    [db, teamId],
  );
  const metrics = useCollection<MetricDoc>(metricsQuery, initialMetrics);
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
  if (sorted.length === 0) {
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
      showDelete={false}
      groups={groups}
      compact
      speakingOrder={speakingOrder}
      absentUserIds={absentUserIds}
      toolbarExtra={
        <QuickAddIssue
          teamId={teamId}
          prefill="Off-track metric: "
          meetingId={meetingId}
        />
      }
    />
  );
}
