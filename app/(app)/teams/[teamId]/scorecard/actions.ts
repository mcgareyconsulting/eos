"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import {
  isScorecardUnit,
  parseScorecardValue,
  type ScorecardUnit,
} from "@/lib/scorecard";
import {
  SCORECARD_PERIODS,
  type MetricInterval,
} from "@/lib/scorecard-periods";
import {
  groupDocId,
  groupNameKey,
  isMetricInterval,
  nextGroupSortOrder,
  normalizeGroupName,
  reorderGroup,
  type ScorecardGroup,
} from "@/lib/scorecard-groups";

const DIRECTIONS = ["gte", "lte", "eq"] as const;
type Direction = (typeof DIRECTIONS)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/scorecard`;
}

export async function addMetric(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const name = String(formData.get("name") ?? "").trim();
  const unitRaw = String(formData.get("unit") ?? "number");
  const directionRaw = String(formData.get("direction") ?? "gte");
  const goalRaw = String(formData.get("goal") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  const groupRaw = String(formData.get("group") ?? "").trim();
  const group = groupRaw === "" ? null : groupRaw;
  const intervalRaw = String(formData.get("interval") ?? "weekly");
  const interval: MetricInterval = (
    SCORECARD_PERIODS as readonly string[]
  ).includes(intervalRaw)
    ? (intervalRaw as MetricInterval)
    : "weekly";

  if (!name) throw new Error("Name required");

  const unit: ScorecardUnit = isScorecardUnit(unitRaw) ? unitRaw : "number";
  const direction: Direction =
    unit === "yesno"
      ? "eq"
      : DIRECTIONS.includes(directionRaw as Direction)
        ? (directionRaw as Direction)
        : "gte";
  const parsedGoal =
    goalRaw === "" ? { ok: true as const, value: null } : parseScorecardValue(goalRaw, unit);
  if (!parsedGoal.ok) {
    throw new Error(
      unit === "yesno"
        ? "Goal must be Yes or No"
        : unit === "time"
          ? "Goal must be a time (h:mm)"
          : "Goal must be a number",
    );
  }
  const goal = parsedGoal.value;

  await db.collection("scorecard_metrics").add({
    team_id: teamId,
    name,
    unit,
    goal,
    direction,
    owner_id,
    group,
    interval,
    sort_order: 0,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

// Renames/clears a metric's section. Kept as its own action (rather than a
// general metric-update) to match the narrow, single-purpose action style
// already used by setEntry.
async function loadGroups(
  db: FirebaseFirestore.Firestore,
  teamId: string,
): Promise<ScorecardGroup[]> {
  const snap = await db
    .collection("scorecard_groups")
    .where("team_id", "==", teamId)
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      team_id: String(x.team_id ?? teamId),
      name: String(x.name ?? ""),
      interval: isMetricInterval(String(x.interval ?? ""))
        ? (String(x.interval) as MetricInterval)
        : "weekly",
      sort_order: Number(x.sort_order ?? 0),
    };
  });
}

/**
 * Assign a metric to a group by name (empty clears it).
 *
 * Assigning also moves the metric into the group's period. A group owns a
 * period, so a weekly measurable dropped into a monthly group would otherwise
 * vanish from both tabs — visible under neither its own interval nor its
 * group's. Silently correcting the interval is the lesser surprise.
 *
 * A name with no group doc yet is still accepted: the grid renders unmanaged
 * labels after the defined groups, so a typed-in name never disappears.
 */
export async function setMetricGroup(
  teamId: string,
  metricId: string,
  groupRaw: string,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const trimmed = normalizeGroupName(groupRaw);
  const group = trimmed === "" ? null : trimmed;

  const patch: { group: string | null; interval?: MetricInterval } = { group };
  if (group) {
    const groups = await loadGroups(db, teamId);
    const match = groups.find((g) => groupNameKey(g.name) === groupNameKey(group));
    // Reuse the stored casing so "compliance" doesn't split the bucket.
    if (match) {
      patch.group = match.name;
      patch.interval = match.interval;
    }
  }

  await db
    .collection("scorecard_metrics")
    .doc(metricId)
    .set(patch, { merge: true });

  revalidatePath(pathFor(teamId));
}

/**
 * Create a group — a name plus the period it belongs to. New groups append to
 * the end of their period, so the order a team builds them in is the order
 * they read in, and nobody has to set a number to get a sensible list.
 */
export async function addScorecardGroup(teamId: string, formData: FormData) {
  const { db } = await requireTeamAccess(teamId);

  const name = normalizeGroupName(String(formData.get("name") ?? ""));
  if (!name) throw new Error("Group name required");

  const intervalRaw = String(formData.get("interval") ?? "weekly");
  const interval: MetricInterval = isMetricInterval(intervalRaw)
    ? intervalRaw
    : "weekly";

  const groups = await loadGroups(db, teamId);
  const existing = groups.find(
    (g) => groupNameKey(g.name) === groupNameKey(name),
  );
  if (existing) {
    throw new Error(`"${existing.name}" already exists on this team.`);
  }

  await db
    .collection("scorecard_groups")
    .doc(groupDocId(teamId, name))
    .set({
      team_id: teamId,
      name,
      interval,
      sort_order: nextGroupSortOrder(groups, interval),
      created_at: FieldValue.serverTimestamp(),
    });

  revalidatePath(pathFor(teamId));
}

/** Move a group up or down within its period. */
export async function moveScorecardGroup(
  teamId: string,
  groupId: string,
  direction: -1 | 1,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "scorecard_groups", groupId, teamId);

  const writes = reorderGroup(await loadGroups(db, teamId), groupId, direction);
  if (writes.length === 0) return;

  const batch = db.batch();
  for (const w of writes) {
    batch.set(
      db.collection("scorecard_groups").doc(w.id),
      { sort_order: w.sort_order },
      { merge: true },
    );
  }
  await batch.commit();

  revalidatePath(pathFor(teamId));
}

/**
 * Delete a group and un-assign its measurables. The metrics themselves are
 * never touched beyond clearing `group` — deleting a bucket must not delete
 * what was in it, and they reappear above the remaining groups as ungrouped.
 */
export async function deleteScorecardGroup(teamId: string, groupId: string) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "scorecard_groups", groupId, teamId);
  const name = normalizeGroupName(String(snap.data()?.name ?? ""));

  const metrics = await db
    .collection("scorecard_metrics")
    .where("team_id", "==", teamId)
    .get();

  const batch = db.batch();
  for (const d of metrics.docs) {
    if (groupNameKey(String(d.data().group ?? "")) !== groupNameKey(name)) {
      continue;
    }
    batch.set(d.ref, { group: null }, { merge: true });
  }
  batch.delete(db.collection("scorecard_groups").doc(groupId));
  await batch.commit();

  revalidatePath(pathFor(teamId));
}

export async function setEntry(
  teamId: string,
  metricId: string,
  weekStartDate: string,
  valueRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const unitRaw = String(snap.data()?.unit ?? "number");
  const unit = isScorecardUnit(unitRaw) ? unitRaw : "number";
  const parsed = parseScorecardValue(valueRaw, unit);
  if (!parsed.ok) return parsed;
  const value = parsed.value;

  const id = `${metricId}__${weekStartDate}`;
  await db
    .collection("scorecard_entries")
    .doc(id)
    .set(
      {
        metric_id: metricId,
        week_start_date: weekStartDate,
        value,
        note: null,
        created_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  revalidatePath(pathFor(teamId));
  return { ok: true };
}

export async function deleteMetric(teamId: string, metricId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  // Delete the metric. Entries are orphaned but harmless; can clean up later.
  await db.collection("scorecard_metrics").doc(metricId).delete();
  revalidatePath(pathFor(teamId));
}
