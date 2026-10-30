// Pairs each imported "No Owner" measurable with the owned measurable it is a
// copy of on another team — ninety exports a shared measurable from every
// team that tracks it, so a team's export lists measurables whose owner sits
// on another team. Imported into the tracking team, those land unowned (the
// owner isn't on its roster) as a second copy. The repair makes the owner's
// team's measurable — the parent — public, folds in any week only a copy
// has, has each copy's team track it in the copy's section, and deletes the
// copies, leaving one record.
//
// Pure planning — scripts/scorecard-share-repair.ts loads the docs and
// applies the plan. A pair is only proposed when it is unambiguous and the
// weeks both copies hold carry the same numbers.

import { normalizeKey, normalizePersonKey } from "./csv-import";

export type RepairMetric = {
  id: string;
  team_id: string;
  name: string;
  owner_id: string | null;
  description?: string | null;
  group?: string | null;
  is_public?: boolean | null;
  shared_team_ids?: string[] | null;
  archived_at?: unknown;
  import_source?: string | null;
};

/** week_start_date → value, per metric id. */
export type EntriesByMetric = Map<string, Map<string, number | null>>;

export type RepairStatus =
  | "repair" // unambiguous, values agree — --apply acts on these
  | "already-tracked" // the share exists; only the unowned copy is left
  | "values-differ" // same name and owner, different numbers — check by hand
  | "ambiguous" // more than one owned measurable could be it
  | "no-match"; // nothing owned elsewhere by that name — the owner queue

export type RepairPlan = {
  unowned: RepairMetric;
  /** "Imported owner: X" from the description, when the import kept it. */
  importedOwner: string | null;
  status: RepairStatus;
  match: RepairMetric | null;
  /** Owned candidates considered (for ambiguous rows). */
  candidates: RepairMetric[];
  weeksCompared: number;
  weeksDiffering: string[];
  /** Weeks only the unowned copy has — kept on it when it is archived. */
  weeksOnlyOnCopy: number;
};

const IMPORTED_OWNER = /^Imported owner:\s*(.+)$/m;

export function importedOwnerOf(description: string | null | undefined): string | null {
  const m = IMPORTED_OWNER.exec(description ?? "");
  return m ? m[1].trim() : null;
}

function isArchived(m: RepairMetric): boolean {
  return m.archived_at != null;
}

export function planShareRepairs(
  metrics: RepairMetric[],
  entries: EntriesByMetric,
  nameOf: (uid: string) => string,
): RepairPlan[] {
  const owned = new Map<string, RepairMetric[]>();
  for (const m of metrics) {
    if (!m.owner_id || isArchived(m)) continue;
    const key = normalizeKey(m.name);
    owned.set(key, [...(owned.get(key) ?? []), m]);
  }

  const plans: RepairPlan[] = [];
  for (const u of metrics) {
    if (u.owner_id || isArchived(u)) continue;
    const importedOwner = importedOwnerOf(u.description);
    let candidates = (owned.get(normalizeKey(u.name)) ?? []).filter(
      (m) => m.team_id !== u.team_id,
    );
    // The kept owner name narrows it when there is one; a candidate whose
    // owner is someone else is not this measurable.
    if (importedOwner) {
      const key = normalizePersonKey(importedOwner);
      candidates = candidates.filter((m) => normalizePersonKey(nameOf(m.owner_id!)) === key);
    }

    const base = { unowned: u, importedOwner, candidates, weeksCompared: 0, weeksDiffering: [], weeksOnlyOnCopy: 0 };
    if (candidates.length === 0) {
      plans.push({ ...base, status: "no-match", match: null });
      continue;
    }
    if (candidates.length > 1) {
      plans.push({ ...base, status: "ambiguous", match: null });
      continue;
    }

    const match = candidates[0];
    const mine = entries.get(u.id) ?? new Map();
    const theirs = entries.get(match.id) ?? new Map();
    const weeksDiffering: string[] = [];
    let weeksCompared = 0;
    let weeksOnlyOnCopy = 0;
    for (const [week, value] of mine) {
      if (!theirs.has(week)) {
        if (value != null) weeksOnlyOnCopy++;
        continue;
      }
      weeksCompared++;
      if ((theirs.get(week) ?? null) !== (value ?? null)) weeksDiffering.push(week);
    }
    weeksDiffering.sort();

    const status: RepairStatus =
      weeksDiffering.length > 0
        ? "values-differ"
        : (match.shared_team_ids ?? []).includes(u.team_id)
          ? "already-tracked"
          : "repair";
    plans.push({ ...base, status, match, weeksCompared, weeksDiffering, weeksOnlyOnCopy });
  }
  return plans;
}

/** One parent measurable and the unowned copies folding into it. */
export type ParentRepair = {
  parent: RepairMetric;
  copies: RepairPlan[];
  /** Weeks a copy has and the parent lacks → value to write on the parent. */
  addWeeks: Map<string, number>;
  /** Weeks two copies fill differently, and the parent has no value for. */
  conflicts: string[];
};

/**
 * Gather the actionable plans ("repair", "already-tracked") by parent. A
 * parent whose copies disagree on a week it lacks is returned with
 * `conflicts` set — the caller leaves it alone.
 */
export function groupByParent(
  plans: RepairPlan[],
  entries: EntriesByMetric,
  /** Fold "values-differ" copies in too — the original's numbers win. */
  acceptDiffering = false,
): ParentRepair[] {
  const byParent = new Map<string, ParentRepair>();
  for (const p of plans) {
    const actionable =
      p.status === "repair" || p.status === "already-tracked" || (acceptDiffering && p.status === "values-differ");
    if (!actionable || !p.match) continue;
    const g: ParentRepair = byParent.get(p.match.id) ?? { parent: p.match, copies: [], addWeeks: new Map(), conflicts: [] };
    g.copies.push(p);
    byParent.set(p.match.id, g);
  }
  for (const g of byParent.values()) {
    const theirs = entries.get(g.parent.id) ?? new Map();
    const conflicts = new Set<string>();
    for (const c of g.copies) {
      for (const [week, value] of entries.get(c.unowned.id) ?? new Map()) {
        if (value == null || theirs.has(week)) continue;
        const prior = g.addWeeks.get(week);
        if (prior !== undefined && prior !== value) conflicts.add(week);
        g.addWeeks.set(week, value);
      }
    }
    g.conflicts = [...conflicts].sort();
  }
  return [...byParent.values()];
}
