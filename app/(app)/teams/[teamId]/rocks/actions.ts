"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import { isRockStatus } from "./status";
import { isRockType } from "./rock-type";

function pathFor(teamId: string) {
  return `/teams/${teamId}/rocks`;
}

export async function addRock(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  // Free-text quarter (e.g. "2026-Q3" or "H2 2026") — not locked to calendar Q.
  const quarter = String(formData.get("quarter") ?? "").trim();
  // Due is optional; UI may prefill end-of-quarter as a suggestion only.
  const due_date = String(formData.get("due_date") ?? "").trim() || null;
  const description =
    String(formData.get("description") ?? "").trim() || null;
  // Team ownership is owner_id only (Owner = Team → null). rock_type is
  // optional legacy/import metadata; new rocks default to individual.
  const rockTypeRaw = String(formData.get("rock_type") ?? "").trim();
  const rock_type = isRockType(rockTypeRaw) ? rockTypeRaw : "individual";

  const ownerRaw = String(formData.get("owner_id") ?? "").trim();
  // Owner = Team → null owner_id (Team Rocks section). Else person, default me.
  const owner_id = ownerRaw === "team" ? null : ownerRaw || uid;

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
  await requireTeamDoc(db, "rocks", rockId, teamId);
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
  await requireTeamDoc(db, "rocks", rockId, teamId);
  await db
    .collection("rocks")
    .doc(rockId)
    .update({ description: trimmed });

  revalidatePath(pathFor(teamId));
}

// Full meta edit from the Rocks tab drawer (view is read-only; this is the
// dedicated edit surface). Title required; empty description clears to null.
// Owner = "team" → null owner_id (Team Rocks section).
export async function updateRockMeta(
  teamId: string,
  rockId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "rocks", rockId, teamId);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");

  const quarter = String(formData.get("quarter") ?? "").trim();
  if (!quarter) throw new Error("Quarter required");

  // Empty due is allowed (null) — don't re-force EOQ on edit.
  const due_date = String(formData.get("due_date") ?? "").trim() || null;
  const description =
    String(formData.get("description") ?? "").trim() || null;

  const ownerRaw = String(formData.get("owner_id") ?? "").trim();
  const owner_id = ownerRaw === "team" ? null : ownerRaw || uid;

  await db.collection("rocks").doc(rockId).update({
    title,
    quarter,
    due_date,
    description,
    owner_id,
  });

  revalidatePath(pathFor(teamId));
  revalidatePath("/home");
}

export async function setRockType(
  teamId: string,
  rockId: string,
  rockType: string,
) {
  if (!isRockType(rockType)) throw new Error("Bad rock type");

  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "rocks", rockId, teamId);
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
  await requireTeamDoc(db, "rocks", rockId, teamId);

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
  // Live L10 rocks segment also shows StatusPopover; keep RSC payloads fresh
  // for anyone who lands mid-meeting without a client subscription yet.
  revalidatePath(`/teams/${teamId}/meetings`);
  revalidatePath("/home");
}

// Removes the rock, linked milestones (todos), and entity_comments.
// Single batch so a partial failure can't orphan children.
export async function deleteRock(teamId: string, rockId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "rocks", rockId, teamId);

  const [milestonesSnap, commentsSnap] = await Promise.all([
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("source_rock_id", "==", rockId)
      .get(),
    db
      .collection("entity_comments")
      .where("team_id", "==", teamId)
      .where("entity_type", "==", "rock")
      .where("entity_id", "==", rockId)
      .get(),
  ]);

  const batch = db.batch();
  milestonesSnap.docs.forEach((d) => batch.delete(d.ref));
  commentsSnap.docs.forEach((d) => batch.delete(d.ref));
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
  await requireTeamDoc(db, "rocks", rockId, teamId);

  const title = String(formData.get("title") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  // P2-6: milestones default to no due date (not end-of-quarter).
  const due_date = String(formData.get("due_date") ?? "").trim() || null;
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
  await requireTeamDoc(db, "todos", milestoneId, teamId);
  await db
    .collection("todos")
    .doc(milestoneId)
    .update({ description: trimmed });

  revalidatePath(pathFor(teamId));
}

// Milestone due dates were write-once at create (P0-3 / P14-20). Empty clears
// the date; otherwise store YYYY-MM-DD from the date input.
export async function updateMilestoneDueDate(
  teamId: string,
  milestoneId: string,
  dueDate: string,
) {
  const trimmed = dueDate.trim() || null;

  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "todos", milestoneId, teamId);
  await db.collection("todos").doc(milestoneId).update({ due_date: trimmed });

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/home");
}
