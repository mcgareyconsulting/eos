// Shared viewer matrix for the access-module tests (not imported by app code).
//
// Teams: P = the item's parent team, S = a team the item is shared into
// (rock share / metric track), O = the off-team assignee's own team,
// X = an unrelated team.

import type { Viewer } from "./types";

export const PARENT = "team-p";
export const SHARED = "team-s";
export const OTHER = "team-o";
export const UNRELATED = "team-x";
export const ALL_TEAMS = [PARENT, SHARED, OTHER, UNRELATED] as const;

function viewer(
  uid: string,
  teams: string[],
  opts: { leaderOf?: string[]; isAdmin?: boolean } = {},
): Viewer {
  return {
    uid,
    isAdmin: opts.isAdmin ?? false,
    teamIds: new Set(teams),
    leaderOf: new Set(opts.leaderOf ?? []),
  };
}

export const VIEWERS = {
  /** Org admin, on no team. */
  admin: viewer("u-admin", [], { isAdmin: true }),
  /** Leader of the parent team. */
  parentLeader: viewer("u-lead", [PARENT], { leaderOf: [PARENT] }),
  /** Plain member of the parent team. */
  parentMember: viewer("u-mem", [PARENT]),
  /** Member of a team the item is shared into. */
  sharedMember: viewer("u-shr", [SHARED]),
  /** Assignee from another team (owns a milestone / the to-do). */
  assignee: viewer("u-asg", [OTHER]),
  /** Rock owner who sits on the shared team, not the parent. */
  offTeamOwner: viewer("u-own", [SHARED]),
  /** Leader of an unrelated team: leads nothing here. */
  otherLeader: viewer("u-xlead", [UNRELATED], { leaderOf: [UNRELATED] }),
  /** On no relevant team. */
  outsider: viewer("u-out", [UNRELATED]),
} satisfies Record<string, Viewer>;

export const VIEWER_ENTRIES = Object.entries(VIEWERS) as [
  keyof typeof VIEWERS,
  Viewer,
][];

/**
 * Teams a viewer can invoke a team-scoped server action from:
 * `requireTeamAccess` admits any team for an admin, else their roster.
 */
export function actionTeams(v: Viewer): readonly string[] {
  return v.isAdmin ? ALL_TEAMS : [...v.teamIds];
}
