"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import { normalizeDescription } from "@/lib/csv-import";
import {
  upsertTaskForTodo,
  deleteTaskForTodo,
  type TodoMirror,
} from "@/lib/google/tasks";
import { selectTodosCompletedDuringMeeting } from "@/lib/todos-archive";

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
  const description =
    normalizeDescription(String(formData.get("description") ?? "")) || null;
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
  // N50: weekly focus. A free flag — see lib/weekly-focus.ts for why it is not
  // one-per-person, and for the L10-to-L10 week it belongs to.
  const weekly_focus = formData.get("weekly_focus") === "on";

  if (!title) throw new Error("Title required");

  const ref = await db.collection("todos").add({
    team_id: teamId,
    title,
    description,
    owner_id,
    due_date,
    completed_at: null,
    archived_at: null,
    visibility,
    weekly_focus,
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
  revalidatePath("/home");
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
  revalidatePath("/home");
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
    normalizeDescription(String(formData.get("description") ?? "")) || null;
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
    weekly_focus: formData.get("weekly_focus") === "on",
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

/**
 * Toggle a to-do's weekly-focus flag (N50).
 *
 * Its own narrow action rather than a trip through `updateTodoMeta`: the pill
 * in the row is a one-click control, and routing it through the full meta
 * update would make an unrelated field (say a description someone is mid-edit
 * on elsewhere) part of the write. Google Tasks is deliberately not mirrored —
 * weekly focus is an EOS concept with no counterpart in a Task, and pushing it
 * into the title is how the `**` convention started.
 */
export async function toggleWeeklyFocus(
  teamId: string,
  todoId: string,
  next: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "todos", todoId, teamId);
  await db.collection("todos").doc(todoId).update({ weekly_focus: next });
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
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

/**
 * Soft-archive or restore a pure to-do (not rock milestones).
 *
 * Restore un-checks it. A to-do is archived because it was completed, and
 * both the Finish sweep and the Monday worker re-archive anything still
 * carrying `completed_at` — so clearing only `archived_at` would let a to-do
 * restored mid-L10 disappear again at Finish. Same rule rocks and headlines
 * already follow on restore.
 */
export async function setTodoArchived(
  teamId: string,
  todoId: string,
  archived: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  if (snap.data()?.source_rock_id) {
    throw new Error("Milestones are managed under Rocks, not archived here");
  }
  await db
    .collection("todos")
    .doc(todoId)
    .update(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null, completed_at: null },
    );
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
  revalidatePath("/home");
}

/**
 * Archive pure to-dos completed *during this L10* (not all done items).
 * Called from endMeeting. Earlier-in-the-week completions stay checked on
 * Active until the Monday morning sweep (or manual archive).
 */
export async function archiveTodosCompletedDuringMeeting(
  teamId: string,
  meetingId: string,
): Promise<number> {
  const { db } = await requireTeamAccess(teamId);
  const meetingSnap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  const m = meetingSnap.data() ?? {};
  const startMs =
    typeof m.started_at?.toMillis === "function"
      ? m.started_at.toMillis()
      : 0;
  const endMs =
    typeof m.ended_at?.toMillis === "function"
      ? m.ended_at.toMillis()
      : Date.now();

  if (!startMs) {
    console.error(
      "[archiveTodosCompletedDuringMeeting] meeting missing started_at",
      meetingId,
    );
    return 0;
  }

  const snap = await db
    .collection("todos")
    .where("team_id", "==", teamId)
    .get();

  const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ids = new Set(
    selectTodosCompletedDuringMeeting(candidates, startMs, endMs),
  );
  if (ids.size === 0) return 0;

  const batch = db.batch();
  for (const d of snap.docs) {
    if (!ids.has(d.id)) continue;
    batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  revalidatePath(pathFor(teamId));
  revalidatePath("/home");
  return ids.size;
}
