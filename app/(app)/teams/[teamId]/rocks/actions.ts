"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { endOfQuarter, toDateString } from "@/lib/dates";
import { isRockStatus } from "./status";
import { isRockType } from "./rock-type";

function pathFor(teamId: string) {
  return `/teams/${teamId}/rocks`;
}

export async function addRock(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const quarter = String(formData.get("quarter") ?? "").trim();
  const due_date =
    String(formData.get("due_date") ?? "").trim() ||
    toDateString(endOfQuarter());
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  const description =
    String(formData.get("description") ?? "").trim() || null;
  const rockTypeRaw = String(formData.get("rock_type") ?? "").trim();
  const rock_type = isRockType(rockTypeRaw) ? rockTypeRaw : "individual";

  if (!title || !quarter) throw new Error("Title and quarter required");

  await db.collection("rocks").add({
    team_id: teamId,
    title,
    quarter,
    due_date,
    owner_id,
    description,
    rock_type,
    status: "on_track",
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

export async function updateRockTitle(
  teamId: string,
  rockId: string,
  title: string,
) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title required");

  const { db } = await requireTeamAccess(teamId);
  await db.collection("rocks").doc(rockId).update({ title: trimmed });

  revalidatePath(pathFor(teamId));
}

// Optional handoff notes — an admin creating/reassigning a rock can leave
// context for whoever owns it. Empty input clears the field back to null.
export async function updateRockDescription(
  teamId: string,
  rockId: string,
  description: string,
) {
  const trimmed = description.trim() || null;

  const { db } = await requireTeamAccess(teamId);
  await db
    .collection("rocks")
    .doc(rockId)
    .update({ description: trimmed });

  revalidatePath(pathFor(teamId));
}

export async function setRockType(
  teamId: string,
  rockId: string,
  rockType: string,
) {
  if (!isRockType(rockType)) throw new Error("Bad rock type");

  const { db } = await requireTeamAccess(teamId);
  await db.collection("rocks").doc(rockId).update({ rock_type: rockType });

  revalidatePath(pathFor(teamId));
}

// Atomic: writes the new status onto the rock AND appends an immutable history
// entry to rock_status_updates. Off-track always requires a "why" comment.
export async function setRockStatus(
  teamId: string,
  rockId: string,
  status: string,
  comment: string | null,
) {
  if (!isRockStatus(status)) throw new Error("Bad status");
  const trimmed = (comment ?? "").trim() || null;
  if (status === "off_track" && !trimmed) {
    throw new Error("Comment required when moving a rock off track.");
  }

  const { uid, db } = await requireTeamAccess(teamId);

  const batch = db.batch();
  batch.update(db.collection("rocks").doc(rockId), { status });
  batch.set(db.collection("rock_status_updates").doc(), {
    rock_id: rockId,
    team_id: teamId,
    status,
    comment: trimmed,
    user_id: uid,
    created_at: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  revalidatePath(pathFor(teamId));
}

// Removes the rock and any todos linked via source_rock_id (milestones).
// Single batch so a partial failure can't orphan milestones.
export async function deleteRock(teamId: string, rockId: string) {
  const { db } = await requireTeamAccess(teamId);

  const milestonesSnap = await db
    .collection("todos")
    .where("team_id", "==", teamId)
    .where("source_rock_id", "==", rockId)
    .get();

  const batch = db.batch();
  milestonesSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection("rocks").doc(rockId));
  await batch.commit();

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/home");
}

// Create a milestone — i.e., a todo tied to a rock via source_rock_id.
// Lives in the todos collection so it reuses TodoCheckbox, toggleTodo,
// and the existing privacy/visibility rules.
export async function addMilestone(
  teamId: string,
  rockId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  const due_date =
    String(formData.get("due_date") ?? "").trim() ||
    toDateString(endOfQuarter());
  const description =
    String(formData.get("description") ?? "").trim() || null;

  if (!title) throw new Error("Title required");

  await db.collection("todos").add({
    team_id: teamId,
    title,
    owner_id,
    due_date,
    description,
    completed_at: null,
    visibility: "team",
    source_issue_id: null,
    source_meeting_id: null,
    source_rock_id: rockId,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
  revalidatePath("/home");
}

// Optional handoff notes on a milestone — same rationale as
// updateRockDescription. Milestones are todos (source_rock_id set), so this
// writes to the todos collection.
export async function updateMilestoneDescription(
  teamId: string,
  milestoneId: string,
  description: string,
) {
  const trimmed = description.trim() || null;

  const { db } = await requireTeamAccess(teamId);
  await db
    .collection("todos")
    .doc(milestoneId)
    .update({ description: trimmed });

  revalidatePath(pathFor(teamId));
}
