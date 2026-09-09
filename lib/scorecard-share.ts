// Cross-team measurable share. A measurable has one home `team_id` and an
// optional `shared_team_ids` — the teams that pulled it onto their own
// scorecard from the org-wide "Add existing" picker. Same shape as the rock
// share in `lib/rocks-share.ts`, and capped at the same 8 for the same
// reason: `firestore.rules` cannot loop, so the membership check there is
// unrolled index by index and a ninth share would be invisible to it.
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

export const MAX_METRIC_SHARES = 8;

export type ShareableMetric = {
  team_id: string;
  shared_team_ids?: string[] | null;
};

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
 */
export function canEditMetricValues({
  metric,
  teamId,
  isAdmin,
}: {
  metric: ShareableMetric;
  teamId: string;
  isAdmin: boolean;
}): boolean {
  return isAdmin || isHomeTeam(metric, teamId);
}

/**
 * The lifecycle gate: who may archive or delete a measurable.
 *
 * **Two conditions, and both must hold.**
 *
 * *Home team.* Never from a borrowing team, admin or not. Remove is the action
 * there, and offering Archive or Delete on a borrowed row is how one team
 * takes another team's measurable off every scorecard at once by reaching for
 * what looks like a remove button.
 *
 * *Owner or org admin.* Decided 2026-09-09: the measurable's `owner_id`, or
 * someone holding the org admin claim. This **narrows** what shipped before,
 * where any member of the home team could delete — a deliberate change, not a
 * side effect, and the reason `deleteMetric` now needs a uid it never used to
 * ask for.
 *
 * Archive and delete share this gate on purpose. They differ enormously in
 * consequence — one is reversible, one destroys every value ever logged — but
 * "who may take this measurable off the scorecard" is one question, and
 * answering it in two places is how the two answers drift. The difference gets
 * stated in the confirmation copy, not in the permissions.
 *
 * **The one definition worth revisiting is "owner".** This reads the
 * measurable's `owner_id` — the person accountable for reporting it. It does
 * not include the team leader, so a team whose measurable is owned by someone
 * who has left cannot tidy it up without an admin. That is a real hole and a
 * one-line change here if leaders are meant to count.
 */
function canManageMetricLifecycle({
  metric,
  teamId,
  uid,
  isAdmin,
}: {
  metric: ManageableMetric;
  teamId: string;
  uid: string;
  isAdmin: boolean;
}): boolean {
  if (!isHomeTeam(metric, teamId)) return false;
  return isAdmin || (!!metric.owner_id && metric.owner_id === uid);
}

/** Reversible: hides the row, keeps every value. Owner or admin, home team. */
export function canArchiveMetric(args: {
  metric: ManageableMetric;
  teamId: string;
  uid: string;
  isAdmin: boolean;
}): boolean {
  return canManageMetricLifecycle(args);
}

/** Irreversible: destroys the measurable and orphans its history. Same gate. */
export function canDeleteMetric(args: {
  metric: ManageableMetric;
  teamId: string;
  uid: string;
  isAdmin: boolean;
}): boolean {
  return canManageMetricLifecycle(args);
}

export type ShareResult =
  | { ok: true; shared_team_ids: string[] }
  | { ok: false; error: string };

/**
 * Add a borrowing team. Idempotent, and refuses past the rules cap rather
 * than writing a share the client listener would then be unable to read —
 * a silent half-share is worse than a refusal that says why.
 */
export function addShare(
  metric: ShareableMetric,
  teamId: string,
): ShareResult {
  if (isHomeTeam(metric, teamId)) {
    return { ok: false, error: "This measurable already lives on this team." };
  }
  const ids = metric.shared_team_ids ?? [];
  if (ids.includes(teamId)) {
    return { ok: true, shared_team_ids: [...ids] };
  }
  if (ids.length >= MAX_METRIC_SHARES) {
    return {
      ok: false,
      error: `A measurable can be on ${MAX_METRIC_SHARES} other scorecards at most. Remove it from another scorecard first.`,
    };
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
