// Shape D — scorecard metric (docs/PERMISSIONS_SPEC.md §3, §3.4).
//
// A thin wrapper over lib/scorecard-share.ts, which stays the source of
// truth for today's rules. Its predicates take the team the action came
// from (`teamId`); here the Viewer carries every team, so "may the viewer"
// means "from some team the viewer can act through". The parity tests in
// metric.test.ts pin that.
//
// Current production behaviour: a metric is on its home team's scorecard
// and on each team in `shared_team_ids` ("track"; the code says "share" /
// "borrow"). The home team edits it and its values; a tracking team only
// reads and may untrack. Archive/delete: the metric owner or an admin, on
// the home team. There is no public/private setting.

import {
  addShare,
  canArchiveMetric,
  canDeleteMetric,
  canEditMetricValues,
  isOnScorecard,
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
  // SPEC P7: a public metric is visible to every person (org metric board);
  // a private one only to the home team and admins, and only a public one
  // can be tracked. Today there is no public/private flag: the scorecard
  // read is home team + tracking teams + admins (this function, and
  // firestore.rules), BUT the "Add existing" catalog (listOrgMetrics /
  // loadOrgMetricCatalog) lists every metric in the org to any member.
  return viewer.isAdmin || onSomeScorecard(metric, viewer);
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
  // SPEC P7: leaders of the home team may archive and delete too (spec
  // §3.4 "The metric owner, leaders and admins"). Today: owner or admin.
  return (
    homeGate(metric, viewer) &&
    check({
      metric,
      teamId: metric.team_id,
      uid: viewer.uid,
      isAdmin: viewer.isAdmin,
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
} = {
  canSee: seesMetric,
  // updateMetric / setMetricGroup: the home-team gate. Matches spec
  // ("the parent team, admins"); SPEC P7 adds the public/private toggle to
  // this same set.
  canEdit: homeGate,
  canEditValues: (metric, viewer) =>
    homeGate(metric, viewer) &&
    canEditMetricValues({
      metric,
      teamId: metric.team_id,
      isAdmin: viewer.isAdmin,
    }),
  // A metric has no thread (spec §5.1 agrees).
  canComment: () => false,
  // SPEC P7: follow a metric only when it is on the scorecard of one of
  // your teams (admins: any); new values notify. Today nothing follows one.
  canFollow: () => false,
  // No thread, so nowhere to mention; defined as canSee per the interface.
  canMention: seesMetric,
  canDelete: (metric, viewer) => lifecycle(canDeleteMetric, metric, viewer),
  canArchive: (metric, viewer) => lifecycle(canArchiveMetric, metric, viewer),
  // SPEC P7: only a public metric can be tracked. Today any member can pull
  // any metric (up to the 8-share cap).
  canTrack: (metric, viewer, teamId) =>
    passesTeamGate(viewer, teamId) && addShare(metric, teamId).ok,
  canUntrack: (metric, viewer, teamId) =>
    passesTeamGate(viewer, teamId) && isSharedIntoTeam(metric, teamId),
};
