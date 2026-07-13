"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";

const VISIBILITIES = ["team", "private"] as const;
type Visibility = (typeof VISIBILITIES)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/todos`;
}

export async function addTodo(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  const due_date = String(formData.get("due_date") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const visibilityRaw = String(formData.get("visibility") ?? "team");
  const visibility: Visibility = VISIBILITIES.includes(
    visibilityRaw as Visibility,
  )
    ? (visibilityRaw as Visibility)
    : "team";

  if (!title) throw new Error("Title required");

  await db.collection("todos").add({
    team_id: teamId,
    title,
    description,
    owner_id,
    due_date,
    completed_at: null,
    visibility,
    source_issue_id: null,
    source_meeting_id: null,
    source_rock_id: null,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

export async function toggleTodo(
  teamId: string,
  todoId: string,
  currentlyComplete: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "todos", todoId, teamId);
  await db
    .collection("todos")
    .doc(todoId)
    .update({
      completed_at: currentlyComplete ? null : FieldValue.serverTimestamp(),
    });
  revalidatePath(pathFor(teamId));
}

export async function updateTodoTitle(
  teamId: string,
  todoId: string,
  title: string,
) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title required");
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "todos", todoId, teamId);
  await db.collection("todos").doc(todoId).update({ title: trimmed });
  revalidatePath(pathFor(teamId));
}

export async function updateTodoDescription(
  teamId: string,
  todoId: string,
  description: string,
) {
  const trimmed = description.trim();
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "todos", todoId, teamId);
  await db
    .collection("todos")
    .doc(todoId)
    .update({ description: trimmed || null });
  revalidatePath(pathFor(teamId));
}

export async function deleteTodo(teamId: string, todoId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "todos", todoId, teamId);
  await db.collection("todos").doc(todoId).delete();
  revalidatePath(pathFor(teamId));
}
