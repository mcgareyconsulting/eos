// Shape D — scorecard metric (docs/PERMISSIONS_SPEC.md §3, §3.4).
//
// A thin wrapper over lib/scorecard-share.ts, which holds the predicates
// (they take the team the action came from, `teamId`); here the Viewer
// carries every team, so "may the viewer" means "from some team the viewer
// can act through". The parity tests in metric.test.ts pin that.
//
// Rules (spec §3.4): a metric is private by default (`is_public` false) and
// is seen by its home team, teams that track it, and admins. A public metric
// is seen by every person and can be tracked by any other team
// (`shared_team_ids`, called "track" in the UI). The home team edits it, its
// values and its public setting; a tracking team only reads and may untrack.
// Archive/delete: the owner, a leader of the home team, or an admin.

import {
  addShare,
  canArchiveMetric,
  canDeleteMetric,
  canEditMetricValues,
  isOnScorecard,
  isPublicMetric,
  isSharedIntoTeam,
  type ManageableMetric,
} from "@/lib/scorecard-share";
import { passesTeamGate, type AccessModule, type Viewer } from "./types";

export type MetricSubject = ManageableMetric;

/** Teams the viewer can act through: their roster teams, or (admin) any. */
function onSomeScorecard(metric: MetricSubject, viewer: Viewer): boolean {
  for (const teamId of viewer.teamIds) {
    if (isOnScorecard(metric, teamId)) return true;
  }
  return false;
}

function seesMetric(metric: MetricSubject, viewer: Viewer): boolean {
  // Public: every person. Private: home team, tracking teams, admins.
  return (
    viewer.isAdmin || isPublicMetric(metric) || onSomeScorecard(metric, viewer)
  );
}

function homeGate(metric: MetricSubject, viewer: Viewer): boolean {
  return passesTeamGate(viewer, metric.team_id);
}

/** Archive/delete share one gate in scorecard-share; so do they here. */
function lifecycle(
  check: typeof canDeleteMetric,
  metric: MetricSubject,
  viewer: Viewer,
): boolean {
  // Owner, leader of the home team, or admin (spec §3.4).
  return (
    homeGate(metric, viewer) &&
    check({
      metric,
      teamId: metric.team_id,
      uid: viewer.uid,
      isAdmin: viewer.isAdmin,
      isLeader: viewer.leaderOf.has(metric.team_id),
    })
  );
}

export const metricAccess: AccessModule<MetricSubject> & {
  /** Type numbers into the metric's cells (setEntry). */
  canEditValues(metric: MetricSubject, viewer: Viewer): boolean;
  canArchive(metric: MetricSubject, viewer: Viewer): boolean;
  /** Add this metric to `teamId`'s scorecard ("Add existing"). */
  canTrack(metric: MetricSubject, viewer: Viewer, teamId: string): boolean;
  /** Take a tracked metric off `teamId`'s scorecard. */
  canUntrack(metric: MetricSubject, viewer: Viewer, teamId: string): boolean;
  /** Flip public/private (setMetricPublic): any home-team member or admin. */
  canSetPublic(metric: MetricSubject, viewer: Viewer): boolean;
} = {
  canSee: seesMetric,
  // updateMetric / setMetricGroup / setMetricPublic: the home-team gate
  // ("the parent team, admins").
  canEdit: homeGate,
  canSetPublic: homeGate,
  canEditValues: (metric, viewer) =>
    homeGate(metric, viewer) &&
    canEditMetricValues({
      metric,
      teamId: metric.team_id,
      isAdmin: viewer.isAdmin,
    }),
  // A metric has no thread (spec §5.1 agrees).
  canComment: () => false,
  // Follow a metric only when it is on the scorecard of one of your teams
  // (admins: any) — never from the "Add existing" picker. Notifications are P7b.
  canFollow: (metric, viewer) =>
    viewer.isAdmin || onSomeScorecard(metric, viewer),
  // No thread, so nowhere to mention; defined as canSee per the interface.
  canMention: seesMetric,
  canDelete: (metric, viewer) => lifecycle(canDeleteMetric, metric, viewer),
  canArchive: (metric, viewer) => lifecycle(canArchiveMetric, metric, viewer),
  // Only a public metric can be tracked (addShare refuses a private one).
  canTrack: (metric, viewer, teamId) =>
    passesTeamGate(viewer, teamId) && addShare(metric, teamId).ok,
  canUntrack: (metric, viewer, teamId) =>
    passesTeamGate(viewer, teamId) && isSharedIntoTeam(metric, teamId),
};
