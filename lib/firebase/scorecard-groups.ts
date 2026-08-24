// Server-side loader for a team's scorecard groups.
// Split from lib/scorecard-groups.ts so the pure rules stay importable from
// client components without dragging firebase-admin in behind them.

import {
  compareGroups,
  isMetricInterval,
  type ScorecardGroup,
} from "@/lib/scorecard-groups";

/**
 * Team scorecard groups. Kept out of the metrics query on purpose: a group is
 * a small piece of team config, not a per-metric field, and both the tab and
 * the L10 need the same ordered list.
 */
export async function loadScorecardGroups(
  db: FirebaseFirestore.Firestore,
  teamId: string,
): Promise<ScorecardGroup[]> {
  const snap = await db
    .collection("scorecard_groups")
    .where("team_id", "==", teamId)
    .get();
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: String(x.team_id ?? teamId),
        name: String(x.name ?? ""),
        interval: isMetricInterval(String(x.interval ?? ""))
          ? (String(x.interval) as ScorecardGroup["interval"])
          : ("weekly" as const),
        sort_order: Number(x.sort_order ?? 0),
      };
    })
    .filter((g) => g.name !== "")
    .sort(compareGroups);
}
