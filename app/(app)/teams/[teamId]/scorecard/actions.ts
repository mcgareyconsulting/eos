"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";

const UNITS = ["number", "currency", "percent", "yesno", "time"] as const;
type Unit = (typeof UNITS)[number];

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

  if (!name) throw new Error("Name required");

  const unit: Unit = UNITS.includes(unitRaw as Unit)
    ? (unitRaw as Unit)
    : "number";
  const direction: Direction = DIRECTIONS.includes(directionRaw as Direction)
    ? (directionRaw as Direction)
    : "gte";
  const goal = goalRaw === "" ? null : Number(goalRaw);
  if (goal !== null && Number.isNaN(goal))
    throw new Error("Goal must be a number");

  await db.collection("scorecard_metrics").add({
    team_id: teamId,
    name,
    unit,
    goal,
    direction,
    owner_id,
    sort_order: 0,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

export async function setEntry(
  teamId: string,
  metricId: string,
  weekStartDate: string,
  valueRaw: string,
) {
  const { db } = await requireTeamAccess(teamId);
  const trimmed = valueRaw.trim();
  const value = trimmed === "" ? null : Number(trimmed);
  if (value !== null && Number.isNaN(value))
    throw new Error("Value must be a number");

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
}

export async function deleteMetric(teamId: string, metricId: string) {
  const { db } = await requireTeamAccess(teamId);
  // Delete the metric. Entries are orphaned but harmless; can clean up later.
  await db.collection("scorecard_metrics").doc(metricId).delete();
  revalidatePath(pathFor(teamId));
}
