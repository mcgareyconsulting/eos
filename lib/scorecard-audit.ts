// Org-wide scorecard audit: every active measurable sorted into what it is —
// a clean original, a same-owner duplicate on another team, a No Owner copy
// of someone's original, or truly unassigned (no owner, and no owned
// measurable of that name anywhere) — and every pair that should carry the
// same numbers run through lib/scorecard-diff.ts. Then rolled up per person,
// so people whose measurables are spread across teams, or whose identical
// copies have drifted apart, stand out.
//
// Pure: scripts/scorecard-audit.ts loads the docs and prints the result.

import { normalizeKey, normalizePersonKey } from "./csv-import";
import { explainDifferences, type DiffExplanation, type Point } from "./scorecard-diff";
import { importedOwnerOf, type RepairMetric } from "./scorecard-share-repair";

export type Category =
  /** Owned, and the only measurable by this name for this owner. */
  | "original"
  /** Owned, same name and owner as an original on another team. */
  | "owned-duplicate"
  /** No owner; an owned measurable of this name (and imported owner) exists. */
  | "copy-of-original"
  /** No owner; several owned measurables could be its original. */
  | "copy-ambiguous"
  /** No owner; the name exists only as other No Owner copies. */
  | "unassigned-duplicated"
  /** No owner; the name is owned elsewhere, but by someone the note doesn't name. */
  | "unassigned-other-owner-has-name"
  /** No owner, and nothing else anywhere carries the name. */
  | "truly-unassigned";

export type AuditRow = {
  metric: RepairMetric;
  category: Category;
  /** The original this one should match, for duplicates and copies. */
  original: RepairMetric | null;
  diff: DiffExplanation | null;
};

export type PersonAudit = {
  uid: string;
  name: string;
  owned: number;
  /** Teams their measurables live on. */
  teams: string[];
  /** Their measurables on a team they are not a member of. */
  offRoster: RepairMetric[];
  /** Names they own on more than one team. */
  duplicatedNames: number;
  /** Duplicates / copies of their originals whose numbers differ. */
  outOfSync: number;
  /** …of which nothing explains the difference. */
  conflicts: number;
  /** No Owner copies of their originals still sitting on other teams. */
  copiesToUnify: number;
  flags: ("SCATTERED" | "OFF ROSTER" | "DUPLICATES" | "OUT OF SYNC" | "CONFLICT")[];
};

/** Measurables on this many teams or more count as spread out. */
export const SCATTERED_TEAMS = 3;

function latest(points: Map<string, Point> | undefined): string {
  let last = "";
  for (const [w, p] of points ?? []) if (p.value != null && w > last) last = w;
  return last;
}

/**
 * Came from a ninety import rather than being made in the app. Either signal
 * is enough: every import path writes `import_source: "csv"` and an
 * `imp-<kind>-…` id (importDocId); the app's create writes neither.
 */
export function isImported(m: { id: string; import_source?: string | null }): boolean {
  return m.import_source === "csv" || m.id.startsWith("imp-metric-");
}

/**
 * Of one owner's same-named measurables, the one to keep: on a team the
 * owner is a member of first, then the one with the most recent number, then
 * a fixed tie-break so reruns agree.
 */
export function pickOriginal(
  list: RepairMetric[],
  ownerTeams: Set<string>,
  entries: Map<string, Map<string, Point>>,
): RepairMetric {
  return [...list].sort(
    (a, b) =>
      Number(ownerTeams.has(b.team_id)) - Number(ownerTeams.has(a.team_id)) ||
      latest(entries.get(b.id)).localeCompare(latest(entries.get(a.id))) ||
      a.id.localeCompare(b.id),
  )[0];
}

export function auditScorecards(input: {
  metrics: RepairMetric[];
  entries: Map<string, Map<string, Point>>;
  /** uid → team ids they are a member of. */
  memberships: Map<string, Set<string>>;
  nameOf: (uid: string) => string;
}): { rows: AuditRow[]; people: PersonAudit[] } {
  const { metrics, entries, memberships, nameOf } = input;
  const active = metrics.filter((m) => m.archived_at == null);
  const byName = new Map<string, RepairMetric[]>();
  for (const m of active) {
    const k = normalizeKey(m.name);
    byName.set(k, [...(byName.get(k) ?? []), m]);
  }
  const diff = (original: RepairMetric, other: RepairMetric) =>
    explainDifferences(entries.get(original.id) ?? new Map(), entries.get(other.id) ?? new Map());

  const rows: AuditRow[] = [];
  for (const group of byName.values()) {
    const owned = group.filter((m) => m.owner_id);
    const unowned = group.filter((m) => !m.owner_id);

    // Per owner, one original: the copy on a team the owner is on, then the
    // one with the most recent number. The rest are duplicates of it.
    const originalOf = new Map<string, RepairMetric>();
    const byOwner = new Map<string, RepairMetric[]>();
    for (const m of owned) byOwner.set(m.owner_id!, [...(byOwner.get(m.owner_id!) ?? []), m]);
    for (const [owner, list] of byOwner) {
      const original = pickOriginal(list, memberships.get(owner) ?? new Set(), entries);
      originalOf.set(owner, original);
      rows.push({ metric: original, category: "original", original: null, diff: null });
      for (const dup of list.filter((m) => m !== original)) {
        rows.push({ metric: dup, category: "owned-duplicate", original, diff: diff(original, dup) });
      }
    }

    for (const u of unowned) {
      const note = importedOwnerOf(u.description);
      const originals = [...originalOf.values()];
      const named = note
        ? originals.filter((o) => normalizePersonKey(nameOf(o.owner_id!)) === normalizePersonKey(note))
        : originals;
      if (named.length === 1) {
        rows.push({ metric: u, category: "copy-of-original", original: named[0], diff: diff(named[0], u) });
      } else if (named.length > 1) {
        rows.push({ metric: u, category: "copy-ambiguous", original: null, diff: null });
      } else if (owned.length > 0) {
        rows.push({ metric: u, category: "unassigned-other-owner-has-name", original: null, diff: null });
      } else if (unowned.length > 1) {
        rows.push({ metric: u, category: "unassigned-duplicated", original: null, diff: null });
      } else {
        rows.push({ metric: u, category: "truly-unassigned", original: null, diff: null });
      }
    }
  }

  const people = new Map<string, PersonAudit>();
  const person = (uid: string) => {
    let p = people.get(uid);
    if (!p) {
      p = { uid, name: nameOf(uid), owned: 0, teams: [], offRoster: [], duplicatedNames: 0, outOfSync: 0, conflicts: 0, copiesToUnify: 0, flags: [] };
      people.set(uid, p);
    }
    return p;
  };
  for (const r of rows) {
    if (r.metric.owner_id) {
      const p = person(r.metric.owner_id);
      p.owned++;
      if (!p.teams.includes(r.metric.team_id)) p.teams.push(r.metric.team_id);
      if (!(memberships.get(p.uid)?.has(r.metric.team_id) ?? false)) p.offRoster.push(r.metric);
      if (r.category === "owned-duplicate") p.duplicatedNames++;
    }
    if (r.original && r.diff) {
      const p = person(r.original.owner_id!);
      if (r.category === "copy-of-original") p.copiesToUnify++;
      if (r.diff.diffs.length) p.outOfSync++;
      if (r.diff.verdict === "conflict") p.conflicts++;
    }
  }
  for (const p of people.values()) {
    if (p.teams.length >= SCATTERED_TEAMS) p.flags.push("SCATTERED");
    if (p.offRoster.length) p.flags.push("OFF ROSTER");
    if (p.duplicatedNames) p.flags.push("DUPLICATES");
    if (p.outOfSync) p.flags.push("OUT OF SYNC");
    if (p.conflicts) p.flags.push("CONFLICT");
  }

  return {
    rows,
    people: [...people.values()].sort(
      (a, b) => b.flags.length - a.flags.length || b.conflicts - a.conflicts || a.name.localeCompare(b.name),
    ),
  };
}

/**
 * The copy most likely to be the real one, judged only by the numbers: of
 * each set of copies that should be the same measurable, the one with the
 * most recent number (then the most numbers, then one with an owner).
 * A guess to check against `original`, which prefers the owner's own team.
 *
 * Sets: an original with its duplicates and No Owner copies; No Owner
 * measurables with no original are grouped by name.
 */
export function originalGuess(
  rows: AuditRow[],
  entries: Map<string, Map<string, Point>>,
): Map<string, RepairMetric> {
  const sets = new Map<string, RepairMetric[]>();
  for (const r of rows) {
    const key = r.category === "original" ? r.metric.id : r.original ? r.original.id : `name:${normalizeKey(r.metric.name)}`;
    sets.set(key, [...(sets.get(key) ?? []), r.metric]);
  }
  const filled = (m: RepairMetric) => [...(entries.get(m.id)?.values() ?? [])].filter((p) => p.value != null).length;
  const guess = new Map<string, RepairMetric>();
  for (const set of sets.values()) {
    const best = [...set].sort(
      (a, b) =>
        latest(entries.get(b.id)).localeCompare(latest(entries.get(a.id))) ||
        filled(b) - filled(a) ||
        Number(!!b.owner_id) - Number(!!a.owner_id) ||
        a.id.localeCompare(b.id),
    )[0];
    for (const m of set) guess.set(m.id, best);
  }
  return guess;
}
