// Cross-team measurable share. A measurable has one home `team_id` and an
// optional `shared_team_ids` — the teams that pulled it onto their own
// scorecard from the org-wide "Add existing" picker. User-facing copy calls
// this "track" (docs/PERMISSIONS_SPEC.md 3.4); the stored field keeps the old
// name until a migration renames it.
//
// **Only a public metric can be tracked** (`is_public`, default false). There
// is no cap on tracking teams: the rules read `shared_team_ids` with
// `hasAny(team_ids)`, so no unrolled index check is left to outgrow.
//
// **The share is a reference, not a copy.** There is one metric doc and one
// set of `scorecard_entries` — those are keyed `${metricId}__${weekStartDate}`
// and carry no team of their own — so every scorecard showing a borrowed
// measurable shows the same numbers and the same history. That is the whole
// point: a value corrected on the home team is corrected everywhere at once,
// and there is never a second copy to drift out of agreement with the first.
//
// Two consequences every caller depends on:
//
//   - **Holding a share is not a right to write values.** Only the home team
//     and org admins may set entries — see `canEditMetricValues`. A borrowing
//     team reads.
//   - **Remove is detach; delete is destroy.** Removing drops one team out of
//     `shared_team_ids` and changes nothing else, so it is safe for any
//     member of the borrowing team and is reversible by re-adding from the
//     picker. Deleting removes the metric doc and every value ever logged
//     against it, for every team at once, which is why it stays with the home
//     team. They are different words because they are different acts, and the
//     UI must not blur them.

export type ShareableMetric = {
  team_id: string;
  shared_team_ids?: string[] | null;
  /** Visible to every person and trackable by other teams. Missing = private. */
  is_public?: boolean | null;
};

/**
 * Does the "Add existing" catalog list this metric for `askingTeamId`?
 * Public metrics, the asking team's own, and (admin) everything.
 */
export function inCatalogFor(
  metric: ShareableMetric,
  askingTeamId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || isPublicMetric(metric) || isHomeTeam(metric, askingTeamId);
}

/** Public metrics are listed in every team's "Add existing" picker and can be tracked. */
export function isPublicMetric(metric: ShareableMetric): boolean {
  return metric.is_public === true;
}

/** A measurable plus the fields the lifecycle gate and the archive filter need. */
export type ManageableMetric = ShareableMetric & {
  owner_id?: string | null;
  archived_at?: unknown;
};

/** A measurable plus what deciding its section on a given scorecard needs. */
export type GroupableMetric = ShareableMetric & {
  group?: string | null;
  interval?: string | null;
  shared_groups?: Record<string, string | null> | null;
};

/**
 * Which section a measurable sits in **on a particular team's scorecard**.
 *
 * Grouping has to be per-team the moment measurables can be borrowed, and the
 * single `group` field cannot be it. That field belongs to the home team, and
 * `setMetricGroup` additionally rewrites the measurable's `interval` to its
 * group's period — so a borrowing team dropping a pulled row into "Customer"
 * would move it on the owner's scorecard *and* could change its cadence for
 * them. `shared_groups` keeps each borrowing team's choice separate, keyed by
 * team id, and the home team keeps `group` exactly as before.
 *
 * A borrowed row does **not** inherit the home team's custom group. "Customer"
 * is a sentence about Transformation's scorecard, not about yours; carried
 * across it would either invent a section the borrowing team never made or
 * silently drop the row into an unrelated one. Unset means the cadence
 * default, which is always true and always meaningful.
 *
 * Returns null only when there is no interval to fall back on, which the
 * callers treat as "weekly".
 */
export function metricGroupForTeam(
  metric: GroupableMetric,
  teamId: string,
): string | null {
  if (isHomeTeam(metric, teamId)) return metric.group?.trim() || null;
  return metric.shared_groups?.[teamId]?.trim() || null;
}

/**
 * Archived measurables drop off scorecards and out of the "Add existing"
 * picker, but are never deleted — the values stay and restoring puts the row
 * back unchanged. Same `archived_at` convention as rocks, issues and
 * headlines, so one rule reads across all four: a timestamp means archived,
 * null or missing means active.
 */
export function isArchivedMetric(metric: ManageableMetric): boolean {
  return !!metric.archived_at;
}

/** The team that owns the measurable and its history. */
export function isHomeTeam(metric: ShareableMetric, teamId: string): boolean {
  return metric.team_id === teamId;
}

/**
 * Borrowed onto this team's scorecard from elsewhere.
 *
 * False for the home team even if its own id somehow appears in the array —
 * a team never borrows from itself, and treating it as a borrow would offer
 * Remove as a way to take a measurable off the scorecard that owns it.
 */
export function isSharedIntoTeam(
  metric: ShareableMetric,
  teamId: string,
): boolean {
  if (isHomeTeam(metric, teamId)) return false;
  return (metric.shared_team_ids ?? []).includes(teamId);
}

/** On this team's scorecard at all, by either route. */
export function isOnScorecard(
  metric: ShareableMetric,
  teamId: string,
): boolean {
  return isHomeTeam(metric, teamId) || isSharedIntoTeam(metric, teamId);
}

/**
 * May the caller type numbers into this measurable's cells?
 *
 * Home team yes, org admin yes, borrowing team no. The borrowing case is the
 * one that matters: the values belong to the team that owns the measurable,
 * and a second team editing them would silently rewrite the first team's
 * scorecard. Non-admins on a borrowing team get a read-only row and Remove.
 *
 * **Archived beats all of it, including admin**, because `setEntry` already
 * refuses an archived measurable server-side. Without that check here the cell
 * would still look editable, accept a number, and only then report that the
 * measurable is archived — an error the UI had every means to prevent. The
 * client predicate and the server rule have to agree on what is writable or
 * one of them is decoration.
 */
export function canEditMetricValues({
  metric,
  teamId,
  isAdmin,
}: {
  metric: ManageableMetric;
  teamId: string;
  isAdmin: boolean;
}): boolean {
  if (isArchivedMetric(metric)) return false;
  return isAdmin || isHomeTeam(metric, teamId);
}

/**
 * The lifecycle gate: who may archive or delete a measurable.
 *
 * **Two conditions, and both must hold.**
 *
 * *Home team.* Never from a tracking team, admin or not. Remove is the action
 * there, and offering Archive or Delete on a tracked row is how one team
 * takes another team's measurable off every scorecard at once by reaching for
 * what looks like a remove button.
 *
 * *Owner, leader of the home team, or org admin* (spec 3.4: "The metric
 * owner, leaders and admins can archive or delete a metric"). Leaders count
 * so a team whose measurable is owned by someone who has left can tidy it up
 * without an admin. `isLeader` is the caller's `team_members.role ===
 * "leader"` on the home team (requireTeamAccess's `membershipRole`); it
 * defaults to false so callers that cannot supply it stay on the narrower
 * owner-or-admin rule.
 *
 * Archive and delete share this gate on purpose: "who may take this
 * measurable off the scorecard" is one question. The difference in
 * consequence is stated in the confirmation copy, not in the permissions.
 */
function canManageMetricLifecycle({
  metric,
  teamId,
  uid,
  isAdmin,
  isLeader = false,
}: LifecycleArgs): boolean {
  if (!isHomeTeam(metric, teamId)) return false;
  return (
    isAdmin ||
    isLeader ||
    (!!metric.owner_id && metric.owner_id === uid)
  );
}

type LifecycleArgs = {
  metric: ManageableMetric;
  teamId: string;
  uid: string;
  isAdmin: boolean;
  isLeader?: boolean;
};

/** Reversible: hides the row, keeps every value. Owner, home leader or admin. */
export function canArchiveMetric(args: LifecycleArgs): boolean {
  return canManageMetricLifecycle(args);
}

/** Irreversible: destroys the measurable and orphans its history. Same gate. */
export function canDeleteMetric(args: LifecycleArgs): boolean {
  return canManageMetricLifecycle(args);
}

export type ShareResult =
  | { ok: true; shared_team_ids: string[] }
  | { ok: false; error: string };

/**
 * Track a metric from `teamId`. Idempotent. Refuses the home team and any
 * private metric (spec 3.4: only a public metric can be tracked).
 */
export function addShare(
  metric: ShareableMetric,
  teamId: string,
): ShareResult {
  if (isHomeTeam(metric, teamId)) {
    return { ok: false, error: "This measurable already lives on this team." };
  }
  if (!isPublicMetric(metric)) {
    return { ok: false, error: "That measurable is private." };
  }
  const ids = metric.shared_team_ids ?? [];
  if (ids.includes(teamId)) {
    return { ok: true, shared_team_ids: [...ids] };
  }
  return { ok: true, shared_team_ids: [...ids, teamId] };
}

/** Drop a borrowing team. Idempotent; never touches the home team. */
export function removeShare(
  metric: ShareableMetric,
  teamId: string,
): string[] {
  return (metric.shared_team_ids ?? []).filter((id) => id !== teamId);
}

/**
 * Make a metric private: tracking ends everywhere. Returns the patch to write
 * (clears `shared_team_ids` and `shared_groups`) and the team ids that lost
 * the metric, for the leader notification (P7b).
 */
export function privateTransition(metric: ShareableMetric): {
  patch: { is_public: false; shared_team_ids: string[]; shared_groups: Record<string, never> };
  removedTeamIds: string[];
} {
  return {
    patch: { is_public: false, shared_team_ids: [], shared_groups: {} },
    removedTeamIds: (metric.shared_team_ids ?? []).filter(
      (t) => t !== metric.team_id,
    ),
  };
}
