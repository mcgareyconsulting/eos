"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import {
  upsertTaskForTodo,
  deleteTaskForTodo,
  type TodoMirror,
} from "@/lib/google/tasks";

// Build the Google Tasks mirror payload from a to-do doc's fields plus any
// just-applied overrides. Every to-do write passes the *complete* current
// state so a PATCH never reverts an unspecified field. Mirroring uses the
// to-do's owner_id — each owner must connect their own Google account.
function mirrorFrom(
  data: FirebaseFirestore.DocumentData,
  overrides: Partial<TodoMirror> = {},
): TodoMirror {
  return {
    title: data.title ?? "",
    notes: data.description ?? null,
    dueDate: data.due_date ?? null,
    completed: !!data.completed_at,
    ...overrides,
  };
}

function ownerUidOf(data: FirebaseFirestore.DocumentData): string {
  return typeof data.owner_id === "string" ? data.owner_id : "";
}

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

  // Durable link to the L10 the to-do was captured in (set by the in-meeting
  // To-Dos form); null for to-dos created outside a meeting.
  const source_meeting_id =
    String(formData.get("source_meeting_id") ?? "").trim() || null;

  if (!title) throw new Error("Title required");

  const ref = await db.collection("todos").add({
    team_id: teamId,
    title,
    description,
    owner_id,
    due_date,
    completed_at: null,
    visibility,
    source_issue_id: null,
    source_meeting_id,
    source_rock_id: null,
    google_task_id: null,
    created_at: FieldValue.serverTimestamp(),
  });

  // Mirror to the owner's Google Tasks (best-effort; no-op if they
  // haven't connected their account).
  const taskId = await upsertTaskForTodo(
    owner_id,
    {
      title,
      notes: description,
      dueDate: due_date,
      completed: false,
    },
  );
  if (taskId) await ref.update({ google_task_id: taskId });

  revalidatePath(pathFor(teamId));
}

export async function toggleTodo(
  teamId: string,
  todoId: string,
  currentlyComplete: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  const nowComplete = !currentlyComplete;
  await db
    .collection("todos")
    .doc(todoId)
    .update({
      completed_at: nowComplete ? FieldValue.serverTimestamp() : null,
    });

  const taskId = await upsertTaskForTodo(
    ownerUidOf(data),
    mirrorFrom(data, { completed: nowComplete }),
    data.google_task_id,
  );
  if (taskId && taskId !== data.google_task_id) {
    await db.collection("todos").doc(todoId).update({ google_task_id: taskId });
  }
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
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  await db.collection("todos").doc(todoId).update({ title: trimmed });

  const taskId = await upsertTaskForTodo(
    ownerUidOf(data),
    mirrorFrom(data, { title: trimmed }),
    data.google_task_id,
  );
  if (taskId && taskId !== data.google_task_id) {
    await db.collection("todos").doc(todoId).update({ google_task_id: taskId });
  }
  revalidatePath(pathFor(teamId));
}

export async function updateTodoDescription(
  teamId: string,
  todoId: string,
  description: string,
) {
  const trimmed = description.trim();
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  await db
    .collection("todos")
    .doc(todoId)
    .update({ description: trimmed || null });

  const taskId = await upsertTaskForTodo(
    ownerUidOf(data),
    mirrorFrom(data, { notes: trimmed || null }),
    data.google_task_id,
  );
  if (taskId && taskId !== data.google_task_id) {
    await db.collection("todos").doc(todoId).update({ google_task_id: taskId });
  }
  revalidatePath(pathFor(teamId));
}

// Full meta edit from the To-Dos tab drawer (list is view-first). Title
// required; empty description clears to null. Mirrors to Google Tasks using
// the (possibly new) owner.
export async function updateTodoMeta(
  teamId: string,
  todoId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");

  const owner_id = String(formData.get("owner_id") ?? "").trim() || uid;
  const due_date = String(formData.get("due_date") ?? "").trim() || null;
  const description =
    String(formData.get("description") ?? "").trim() || null;
  const visibilityRaw = String(formData.get("visibility") ?? "team");
  const visibility: Visibility = VISIBILITIES.includes(
    visibilityRaw as Visibility,
  )
    ? (visibilityRaw as Visibility)
    : "team";

  await db.collection("todos").doc(todoId).update({
    title,
    owner_id,
    due_date,
    description,
    visibility,
  });

  const taskId = await upsertTaskForTodo(
    owner_id,
    mirrorFrom(data, {
      title,
      notes: description,
      dueDate: due_date,
    }),
    data.google_task_id,
  );
  if (taskId && taskId !== data.google_task_id) {
    await db.collection("todos").doc(todoId).update({ google_task_id: taskId });
  }
  revalidatePath(pathFor(teamId));
  revalidatePath("/home");
}

export async function deleteTodo(teamId: string, todoId: string) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  await db.collection("todos").doc(todoId).delete();
  await deleteTaskForTodo(ownerUidOf(data), data.google_task_id);
  revalidatePath(pathFor(teamId));
}
