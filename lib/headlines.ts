// Shared section-split and owner-grouping rules for headlines, used by both
// the standalone Headlines tab and the in-meeting Headlines segment. Both
// surfaces already resolve a per-row display name their own way (team
// member lookup, "You", or a CSV-import fallback to source_owner_name /
// from_label) — this module only owns how to split into sections and fold
// rows into name-keyed groups once a caller has resolved that name, so the
// two surfaces can't drift on what "grouped by owner" or "cascading" means.

export type HeadlineKind = "customer" | "employee" | "cascading" | "general";

export type SectionableHeadline = {
  kind: HeadlineKind;
  broadcast?: boolean | null;
};

/**
 * Cascading-kind headlines and incoming broadcast copies (org-wide,
 * read-only copies of another team's cascading headline) form their own
 * "Cascading" section, kept apart from this team's own headlines. Both
 * lists keep the caller's input order.
 */
export function splitCascadingSection<T extends SectionableHeadline>(
  headlines: T[],
): { team: T[]; cascading: T[] } {
  const team: T[] = [];
  const cascading: T[] = [];
  for (const h of headlines) {
    if (h.kind === "cascading" || h.broadcast) cascading.push(h);
    else team.push(h);
  }
  return { team, cascading };
}

/** Group heading for rows whose display name didn't resolve to anyone. */
export const UNKNOWN_OWNER_LABEL = "No owner";

// Both surfaces already fall back to this exact glyph when nothing resolves
// (team member lookup, "You", source_owner_name, from_label all miss) —
// grouping keys off of it so an unresolved row lands in the trailing
// UNKNOWN_OWNER_LABEL group instead of getting its own one-row "—" group.
const UNRESOLVED_NAME = "—";

export type OwnerGroup<T> = {
  name: string;
  headlines: T[];
};

/**
 * Folds an already-ordered list into groups keyed by resolved display name
 * (whatever the caller's creatorName()-style function returns — a team
 * member's full name, "You", or a CSV-import owner label), preserving each
 * group's internal order (callers sort before grouping) and the order names
 * first appear in. Rows with no resolvable name collect into one group that
 * always sorts last, regardless of where it first appeared.
 */
/**
 * Is this headline archived? Shared so the tab and the L10 segment cannot
 * drift — they each had their own copy of this one-liner until 2026-08-26.
 */
export function isArchivedHeadline(h: { archived_at?: unknown }): boolean {
  return h.archived_at != null;
}

export function groupByOwner<T>(
  headlines: T[],
  getOwnerName: (h: T) => string,
): OwnerGroup<T>[] {
  const order: string[] = [];
  const byName = new Map<string, T[]>();
  const unknown: T[] = [];

  for (const h of headlines) {
    const name = getOwnerName(h).trim();
    if (!name || name === UNRESOLVED_NAME) {
      unknown.push(h);
      continue;
    }
    let bucket = byName.get(name);
    if (!bucket) {
      bucket = [];
      byName.set(name, bucket);
      order.push(name);
    }
    bucket.push(h);
  }

  const groups: OwnerGroup<T>[] = order.map((name) => ({
    name,
    headlines: byName.get(name)!,
  }));
  if (unknown.length > 0) {
    groups.push({ name: UNKNOWN_OWNER_LABEL, headlines: unknown });
  }
  return groups;
}
