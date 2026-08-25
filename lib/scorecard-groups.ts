// Scorecard groups — a named, ordered bucket of measurables within a period.
// "Group" in the UI and `group` in the data, matching ninety's own "Group
// Name" column and what the client says out loud.
//
// Before this, `group` was a free-text label typed onto each metric and the
// grid sorted the resulting names alphabetically. That put Compliance above
// Weekly, which is backwards: Compliance IS a weekly group, it just doesn't
// take precedence over the ordinary weekly measurables. Alphabetical order
// can't express that, so a group became a thing you create — with a name, a
// period, and a position you choose (N40, daniel 2026-08-24).
//
// Metrics still carry `group` as the group's NAME rather than an id, which is
// what the importer already writes (ninety's "Group Name" column) and what the
// grid already reads. The group doc adds the two things a bare string can't
// carry: which period it belongs to, and where it sits.

import { SCORECARD_PERIODS, type MetricInterval } from "@/lib/scorecard-periods";

export type ScorecardGroup = {
  id: string;
  team_id: string;
  name: string;
  interval: MetricInterval;
  /** Ascending. Ties fall back to name so ordering is never arbitrary. */
  sort_order: number;
};

/** A group name is the join key, so it has to normalize the same way twice. */
export function normalizeGroupName(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Case-insensitive identity for a group name. "Compliance" and "compliance"
 * are the same group — the importer and a hand-typed cell must not create two.
 */
export function groupNameKey(raw: string | null | undefined): string {
  return normalizeGroupName(raw).toLowerCase();
}

/**
 * Deterministic doc id, so re-importing the same file updates the group it
 * created last time instead of duplicating it. Mirrors how the importer keys
 * metrics by team + name.
 */
export function groupDocId(teamId: string, name: string): string {
  const slug = groupNameKey(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${teamId}__group__${slug || "unnamed"}`;
}

export function isMetricInterval(raw: string): raw is MetricInterval {
  return (SCORECARD_PERIODS as readonly string[]).includes(raw);
}

/** Ascending sort_order, then name — never arbitrary, never alphabetical-only. */
export function compareGroups(a: ScorecardGroup, b: ScorecardGroup): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

/**
 * The order a new group should take: after everything already in its period.
 * Import relies on this too, so a file whose rows run Weekly-then-Compliance
 * produces exactly that order without anyone setting it by hand.
 */
export function nextGroupSortOrder(
  groups: ScorecardGroup[],
  interval: MetricInterval,
): number {
  const inPeriod = groups.filter((g) => g.interval === interval);
  if (inPeriod.length === 0) return 0;
  return Math.max(...inPeriod.map((g) => g.sort_order)) + 1;
}

/**
 * Order the group names present on a set of metrics, using the team's group
 * docs for position and dropping any that don't belong to this period.
 *
 * A name with no group doc yet — hand-typed, or imported before groups
 * existed — still renders. It sorts after every defined group, alphabetically
 * among its peers, so unmanaged labels collect at the bottom rather than
 * silently disappearing or jumping the queue.
 */
export function orderGroupNames(
  names: string[],
  groups: ScorecardGroup[],
  interval: MetricInterval,
): string[] {
  const byKey = new Map(groups.map((g) => [groupNameKey(g.name), g]));

  const defined: ScorecardGroup[] = [];
  const undefinedNames: string[] = [];
  for (const name of names) {
    const g = byKey.get(groupNameKey(name));
    // A group doc for another period means these metrics are mis-filed, not
    // that the group is unknown — keep it out of this period's ordering.
    if (g && g.interval !== interval) continue;
    if (g) defined.push({ ...g, name });
    else undefinedNames.push(name);
  }

  return [
    ...defined.sort(compareGroups).map((g) => g.name),
    ...undefinedNames.sort((a, b) => a.localeCompare(b)),
  ];
}

/**
 * Move a group one place up or down within its period, returning only the
 * groups whose sort_order actually changed.
 *
 * Positions are rewritten as a dense 0..n-1 sequence rather than nudged, so a
 * list that arrived with duplicate or sparse orders (an import, a hand edit)
 * comes out clean instead of accumulating collisions.
 */
export function reorderGroup(
  groups: ScorecardGroup[],
  groupId: string,
  direction: -1 | 1,
): { id: string; sort_order: number }[] {
  const target = groups.find((g) => g.id === groupId);
  if (!target) return [];

  const inPeriod = groups
    .filter((g) => g.interval === target.interval)
    .sort(compareGroups);

  const from = inPeriod.findIndex((g) => g.id === groupId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= inPeriod.length) return [];

  const next = [...inPeriod];
  [next[from], next[to]] = [next[to], next[from]];

  return next
    .map((g, i) => ({ id: g.id, sort_order: i }))
    .filter((row) => {
      const before = inPeriod.find((g) => g.id === row.id);
      return before?.sort_order !== row.sort_order;
    });
}
