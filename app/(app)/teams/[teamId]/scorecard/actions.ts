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
export async function setMetricGroup(
  teamId: string,
  metricId: string,
  groupRaw: string,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const trimmed = groupRaw.trim();
  const group = trimmed === "" ? null : trimmed;

  await db
    .collection("scorecard_metrics")
    .doc(metricId)
    .set({ group }, { merge: true });

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
