// Fold same-owner imported duplicates into one. ninety exported a shared
// measurable once per team, and where the owner was on the roster of more
// than one of those teams the import gave every copy that owner — the
// "Duplicate of own original on another team" rows of the scorecard audit.
//
// **Only imported measurables are touched** (isImported). A measurable made
// in the app is never deleted, never written to and never chosen as the
// original: owners update their own at cutover, and a later check compares
// what's left. So the original here is picked among the imported copies
// alone (pickOriginal: the copy on a team the owner is on, then the one with
// the most recent number), and app-made copies of the same name are reported
// as left alone. For each original:
//   1. weeks a duplicate has and the original lacks are written onto the
//      original;
//   2. every duplicate's team tracks the original, in the section that team
//      had the duplicate in — and so does any team that was tracking a
//      duplicate; the original goes public when another team now tracks it
//      (tracking requires it); followers carry over;
//   3. the duplicates and their values are deleted.
// The original keeps its id, owner, team, section and every value it had.
//
// Held back (status other than "ready"), nothing written:
//   - "mismatch": the names differ beyond case and spacing ("NPS %" vs
//     "NPS"), or the unit or interval differs — the audit groups names
//     loosely, so these may be different measurables;
//   - "fill-conflict": two duplicates hold different numbers for a week the
//     original lacks;
//   - "differs": a duplicate and the original hold different numbers for the
//     same week; `keepOriginalNumbers` lets them through, original winning.
//
// Re-importing a team's ninety file recreates a deleted duplicate (import ids
// are fixed by team and name) — run the merge after the last import.

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { recordAccessChange } from "./access-audit";
import { stamp, stampBeforeDelete } from "./audit-stamp";
import { isImported, pickOriginal, type AuditRow } from "./scorecard-audit";
import type { Point } from "./scorecard-diff";
import type { RepairMetric } from "./scorecard-share-repair";

export type Disagreement = { duplicateId: string; week: string; original: number; duplicate: number };

export type MergeStatus = "ready" | "mismatch" | "fill-conflict" | "differs";

export type MergePlan = {
  original: RepairMetric;
  duplicates: RepairMetric[];
  /** Weeks to write onto the original: value and the duplicate it came from. */
  fill: Map<string, { value: number; from: string }>;
  /** Weeks both hold a number for, and the numbers differ. */
  disagreements: Disagreement[];
  /** Weeks the original lacks that two duplicates fill differently. */
  fillConflicts: string[];
  /** For "mismatch": what differs. */
  mismatches: string[];
  /** The original's numbers win over a duplicate's for the same week. */
  keepOriginalNumbers: boolean;
  /** Same owner and name, made in the app: reported, never touched. */
  leftAlone: RepairMetric[];
  status: MergeStatus;
};

type Values = Map<string, Point>;

/** Same name to a person reading it: case and runs of spaces aside. */
const exactName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Fill, disagreements and fill conflicts for one original and its duplicates. */
function compareValues(original: Values, duplicates: { id: string; values: Values }[]) {
  const fill = new Map<string, { value: number; from: string }>();
  const disagreements: Disagreement[] = [];
  const conflicts = new Set<string>();
  for (const d of duplicates) {
    for (const [week, p] of d.values) {
      if (p.value == null) continue;
      const o = original.get(week)?.value ?? null;
      if (o != null) {
        if (o !== p.value) disagreements.push({ duplicateId: d.id, week, original: o, duplicate: p.value });
        continue;
      }
      const prior = fill.get(week);
      if (prior && prior.value !== p.value) conflicts.add(week);
      else if (!prior) fill.set(week, { value: p.value, from: d.id });
    }
  }
  disagreements.sort((a, b) => a.week.localeCompare(b.week) || a.duplicateId.localeCompare(b.duplicateId));
  return { fill, disagreements, fillConflicts: [...conflicts].sort() };
}

function statusOf(
  p: Pick<MergePlan, "mismatches" | "fillConflicts" | "disagreements">,
  opts: { keepOriginalNumbers?: boolean },
): MergeStatus {
  if (p.mismatches.length) return "mismatch";
  if (p.fillConflicts.length) return "fill-conflict";
  if (p.disagreements.length && !opts.keepOriginalNumbers) return "differs";
  return "ready";
}

export function planDuplicateMerges(
  rows: AuditRow[],
  entries: Map<string, Values>,
  /** uid → team ids they are a member of (for picking the original). */
  memberships: Map<string, Set<string>>,
  opts: { keepOriginalNumbers?: boolean } = {},
): MergePlan[] {
  // Each audit set: an owner's same-named measurables (original + duplicates).
  const sets = new Map<string, RepairMetric[]>();
  for (const r of rows) {
    if (r.category !== "owned-duplicate" || !r.original) continue;
    const set = sets.get(r.original.id) ?? [r.original];
    set.push(r.metric);
    sets.set(r.original.id, set);
  }

  const plans: MergePlan[] = [];
  for (const set of sets.values()) {
    const imported = set.filter(isImported);
    const leftAlone = set.filter((m) => !isImported(m));
    if (imported.length < 2) continue; // nothing imported to fold together
    const original = pickOriginal(imported, memberships.get(imported[0].owner_id!) ?? new Set(), entries);
    const duplicates = imported.filter((m) => m !== original);
    const mismatches: string[] = [];
    for (const d of duplicates) {
      if (exactName(d.name) !== exactName(original.name)) mismatches.push(`name "${d.name}" vs "${original.name}"`);
      if ((d.unit ?? null) !== (original.unit ?? null)) mismatches.push(`unit ${d.unit ?? "—"} vs ${original.unit ?? "—"}`);
      if ((d.interval ?? "weekly") !== (original.interval ?? "weekly")) {
        mismatches.push(`interval ${d.interval ?? "weekly"} vs ${original.interval ?? "weekly"}`);
      }
    }
    const values = compareValues(
      entries.get(original.id) ?? new Map(),
      duplicates.map((d) => ({ id: d.id, values: entries.get(d.id) ?? new Map() })),
    );
    const base = { original, duplicates, ...values, mismatches, keepOriginalNumbers: !!opts.keepOriginalNumbers, leftAlone };
    plans.push({ ...base, status: statusOf(base, opts) });
  }
  return plans.sort((a, b) => a.original.name.localeCompare(b.original.name));
}

export type MergeResult = { ok: boolean; problems: string[]; tracking: string[]; filled: number };

const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

type MetricDoc = RepairMetric & {
  follower_ids?: string[] | null;
  shared_groups?: Record<string, string | null> | null;
};

async function valuesOf(db: Firestore, metricId: string) {
  const snap = await db.collection("scorecard_entries").where("metric_id", "==", metricId).get();
  const values: Values = new Map();
  for (const d of snap.docs) values.set(d.data().week_start_date as string, { value: (d.data().value as number | null) ?? null });
  return { values, refs: snap.docs.map((d) => d.ref) };
}

/**
 * Apply one "ready" plan. Everything is re-read first: the plan is refused
 * if a doc moved (owner, team, archived, gone), and the values are compared
 * afresh — a number entered on either side since the plan was made is
 * copied over if it fills a gap, and refuses the merge if it disagrees. The
 * original's share fields are updated in a transaction so a team that starts
 * tracking it meanwhile isn't dropped. The result is checked after writing.
 */
export async function applyDuplicateMerge(db: Firestore, plan: MergePlan, actorUid: string): Promise<MergeResult> {
  const refused = (problems: string[]): MergeResult => ({ ok: false, problems, tracking: [], filled: 0 });
  if (plan.status !== "ready") return refused([`plan is ${plan.status}`]);
  const metrics = db.collection("scorecard_metrics");
  const entries = db.collection("scorecard_entries");

  const [oSnap, ...dSnaps] = await db.getAll(metrics.doc(plan.original.id), ...plan.duplicates.map((d) => metrics.doc(d.id)));
  const o = oSnap.data() as MetricDoc | undefined;
  const problems: string[] = [];
  if (!isImported(plan.original) || plan.duplicates.some((d) => !isImported(d))) {
    return refused(["a measurable in the plan was made in the app — those are never touched"]);
  }
  if (!o) problems.push("original no longer exists");
  else if (o.archived_at != null) problems.push("original is archived");
  else if (o.owner_id !== plan.original.owner_id) problems.push("original's owner changed");
  dSnaps.forEach((s, i) => {
    const d = s.data() as MetricDoc | undefined;
    const was = plan.duplicates[i];
    if (!d) problems.push(`duplicate on team ${was.team_id} no longer exists`);
    else if (d.archived_at != null) problems.push(`duplicate on team ${d.team_id} is archived`);
    else if (d.owner_id !== plan.original.owner_id) problems.push(`duplicate on team ${d.team_id} has a different owner now`);
    else if (d.team_id !== was.team_id) problems.push(`duplicate ${s.id} moved teams`);
  });
  if (problems.length) return refused(problems);
  const dups = dSnaps.map((s) => ({ id: s.id, ...(s.data() as Omit<MetricDoc, "id">) })) as MetricDoc[];

  // Values as they are now, not as they were at the dry run.
  const originalNow = await valuesOf(db, plan.original.id);
  const dupsNow = await Promise.all(dups.map(async (d) => ({ id: d.id, ...(await valuesOf(db, d.id)) })));
  const now = compareValues(originalNow.values, dupsNow);
  if (now.fillConflicts.length) return refused([`duplicates now disagree on ${now.fillConflicts.join(", ")}`]);
  if (now.disagreements.length && !plan.keepOriginalNumbers) {
    return refused([`numbers now differ on ${unique(now.disagreements.map((d) => d.week)).join(", ")} — re-run the dry run`]);
  }

  // 1. Weeks only a duplicate has, onto the original (merge, like the app's
  //    own setEntry, so an existing blank entry keeps its other fields).
  const weeks = [...now.fill.keys()];
  for (let i = 0; i < weeks.length; i += 400) {
    const batch = db.batch();
    for (const week of weeks.slice(i, i + 400)) {
      batch.set(
        entries.doc(`${plan.original.id}__${week}`),
        {
          metric_id: plan.original.id,
          week_start_date: week,
          value: now.fill.get(week)!.value,
          note: null,
          created_at: FieldValue.serverTimestamp(),
          ...stamp(actorUid),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  // 2. Share, in a transaction against the original as it is at write time.
  const share = await db.runTransaction(async (tx) => {
    const ref = metrics.doc(plan.original.id);
    const cur = ((await tx.get(ref)).data() ?? {}) as MetricDoc;
    const home = cur.team_id;
    const before = unique(cur.shared_team_ids ?? []);
    const groups: Record<string, string | null> = { ...(cur.shared_groups ?? {}) };
    const tracking = [...before];
    const add = (teamId: string, group: string | null) => {
      if (teamId === home) return;
      if (!tracking.includes(teamId)) tracking.push(teamId);
      // A team already tracking keeps its section; a stale key for a team
      // that isn't tracking yet is replaced.
      if (!before.includes(teamId) || !(teamId in groups)) groups[teamId] = group;
    };
    for (const d of dups) {
      add(d.team_id, d.group ?? null);
      for (const t of d.shared_team_ids ?? []) add(t, d.shared_groups?.[t] ?? null);
    }
    const followers = unique([...(cur.follower_ids ?? []), ...dups.flatMap((d) => d.follower_ids ?? [])]);
    const goesPublic = tracking.length > 0 && !cur.is_public;
    tx.update(ref, {
      ...(tracking.length > 0 ? { is_public: true, shared_team_ids: tracking, shared_groups: groups } : {}),
      follower_ids: followers,
      ...stamp(actorUid),
    });
    return { home, before, tracking, goesPublic };
  });

  if (share.goesPublic) {
    await recordAccessChange(db, {
      kind: "metric_public",
      actorUid,
      entityId: plan.original.id,
      teamId: share.home,
      before: { is_public: false },
      after: { is_public: true },
    });
  }
  for (const t of share.tracking.filter((t) => !share.before.includes(t))) {
    await recordAccessChange(db, {
      kind: "track",
      actorUid,
      entityId: plan.original.id,
      teamId: t,
      before: { shared_team_ids: share.before },
      after: { shared_team_ids: share.tracking, tracked_by_team_id: t },
    });
  }

  // 3. The duplicates and their values. Stamped first so audit_log names who;
  //    the metric doc goes last, so a crash leaves it to retry.
  for (const d of dupsNow) {
    const refs = [...d.refs, metrics.doc(d.id)];
    await stampBeforeDelete(refs, actorUid);
    for (let i = 0; i < refs.length; i += 400) {
      const del = db.batch();
      refs.slice(i, i + 400).forEach((r) => del.delete(r));
      await del.commit();
    }
  }

  // Check what landed.
  const after = (await metrics.doc(plan.original.id).get()).data() as MetricDoc | undefined;
  for (const t of share.tracking) if (!after?.shared_team_ids?.includes(t)) problems.push(`team ${t} is not tracking the original`);
  if (share.tracking.length && !after?.is_public) problems.push("original is not public");
  for (const d of dups) {
    if ((await metrics.doc(d.id).get()).exists) problems.push(`duplicate ${d.id} still exists`);
    if ((await entries.where("metric_id", "==", d.id).get()).size) problems.push(`duplicate ${d.id} still has values`);
  }
  for (const week of weeks) {
    if ((await entries.doc(`${plan.original.id}__${week}`).get()).data()?.value == null) {
      problems.push(`week ${week} missing on the original`);
    }
  }
  return { ok: problems.length === 0, problems, tracking: share.tracking, filled: weeks.length };
}
