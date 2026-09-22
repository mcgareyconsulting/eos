"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { FieldValue } from "firebase-admin/firestore";
import {
  getTeamMembers,
  requireTeamAccess,
  requireTeamDoc,
} from "@/lib/firebase/teams";
import { normalizeDescription } from "@/lib/csv-import";
import {
  upsertTaskForTodo,
  deleteTaskForTodo,
  type TodoMirror,
} from "@/lib/google/tasks";
import { selectTodosCompletedDuringMeeting } from "@/lib/todos-archive";
import { canTickMilestone } from "@/lib/rocks-share";
import { notify } from "@/lib/firebase/notifications";
import { recordActivity } from "@/lib/firebase/activity";
import { joinNames } from "@/lib/activity";
import { loadUserNames } from "@/lib/firebase/user-names";
import { formatDateOnly } from "@/lib/dates";
import {
  addedFollowerRecipients,
  applyFollowerEdit,
  followersAfterOwnerChange,
  initialFollowers,
  recipientsFor,
  summarizeTodoChanges,
  toggleFollower,
} from "@/lib/notifications";

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

function followerIdsOf(data: FirebaseFirestore.DocumentData): string[] {
  return Array.isArray(data.follower_ids)
    ? data.follower_ids.filter((x): x is string => typeof x === "string")
    : [];
}

/** The pieces every to-do notification needs — see lib/notifications.ts. */
function notifyTarget(
  teamId: string,
  teamName: string,
  todoId: string,
  data: FirebaseFirestore.DocumentData,
) {
  return {
    team: { id: teamId, name: teamName },
    entity: {
      type: "todo" as const,
      id: todoId,
      title: String(data.title ?? "To-do"),
    },
  };
}

const VISIBILITIES = ["team", "private"] as const;
type Visibility = (typeof VISIBILITIES)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/todos`;
}

export async function addTodo(teamId: string, formData: FormData) {
  const { uid, db, team } = await requireTeamAccess(teamId);

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
  // Weekly focus. A free flag — see lib/weekly-focus.ts for why it is not
  // one-per-person, and for the L10-to-L10 week it belongs to.
  const weekly_focus = formData.get("weekly_focus") === "on";

  if (!title) throw new Error("Title required");

  // Creator + owner follow from the start; that is the "assign and follow"
  // shape the client uses today (N61). "Add followers" picks ride along,
  // checked against the roster so a stale or hand-rolled form can't
  // subscribe someone who isn't on the team. A private to-do is readable by
  // its owner only, so nobody else can meaningfully follow it.
  const roster = new Set(
    (await getTeamMembers(teamId)).map((m) => m.user_id),
  );
  const picked =
    visibility === "private"
      ? []
      : formData
          .getAll("follower_ids")
          .filter((v): v is string => typeof v === "string" && roster.has(v));
  const follower_ids = initialFollowers({
    creatorId: uid,
    ownerId: owner_id,
    extraIds: picked,
  });

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
    created_by: uid,
    follower_ids,
    created_at: FieldValue.serverTimestamp(),
  });

  const target = notifyTarget(teamId, team.name, ref.id, { title });
  const dueDetail = due_date ? `Due ${formatDateOnly(due_date)}` : null;
  if (owner_id !== uid) {
    await notify({
      db,
      recipientIds: [owner_id],
      kind: "assigned",
      ...target,
      actor: { id: uid },
      detail: dueDetail,
    });
  }
  const addedFollowers = addedFollowerRecipients({
    creatorId: uid,
    ownerId: owner_id,
    extraIds: picked,
  });
  await notify({
    db,
    recipientIds: addedFollowers,
    kind: "following",
    ...target,
    actor: { id: uid },
    detail: dueDetail,
  });

  const names = await loadUserNames(db, [owner_id, ...addedFollowers]);
  await recordActivity({
    db,
    teamId,
    entity: { type: "todo", id: ref.id, visibility, ownerId: owner_id },
    kind: "created",
    actor: { id: uid },
    detail: [
      `Owner ${owner_id === uid ? "you" : names.get(owner_id) ?? "—"}`,
      dueDetail,
      addedFollowers.length > 0
        ? `Following: ${joinNames(addedFollowers, (id) => names.get(id))}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
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

/**
 * The to-do a tick from `teamId` may complete. A plain to-do must live on
 * that team. A milestone goes through the sharing rule instead
 * (`canTickMilestone`): the parent team (or an admin) ticks anything, and
 * anyone else — a shared team's member, or an assignee from any team — ticks
 * only their own milestone or one on a rock they own. Admin SDK bypasses firestore.rules, so this is the real gate.
 */
async function requireTickableTodo(
  db: FirebaseFirestore.Firestore,
  todoId: string,
  teamId: string,
  uid: string,
  isAdmin: boolean,
) {
  const snap = await db.collection("todos").doc(todoId).get();
  if (!snap.exists) notFound();
  const data = snap.data() ?? {};
  const rockId = data.source_rock_id as string | null | undefined;
  if (!rockId) {
    if (data.team_id !== teamId) notFound();
    return snap;
  }
  const rockSnap = await db.collection("rocks").doc(rockId).get();
  const rock = rockSnap.data();
  if (!rock) {
    if (data.team_id !== teamId) notFound();
    return snap;
  }
  const rockTeamId = String(rock.team_id ?? "");
  const ok = canTickMilestone(
    {
      team_id: rockTeamId,
      owner_id: (rock.owner_id as string | null) ?? null,
      shared_team_ids: (rock.shared_team_ids as string[] | null) ?? [],
    },
    { owner_id: (data.owner_id as string | null) ?? null },
    { uid, fullAccess: isAdmin || rockTeamId === teamId },
  );
  if (!ok) notFound();
  return snap;
}

export async function toggleTodo(
  teamId: string,
  todoId: string,
  currentlyComplete: boolean,
) {
  const { uid, db, team, isAdmin } = await requireTeamAccess(teamId);
  const snap = await requireTickableTodo(db, todoId, teamId, uid, isAdmin);
  const data = snap.data() ?? {};
  // A milestone ticked from another team's page (its assignee, from their
  // own team) is still an event on the rock's team: file the notification
  // and the activity row there, as that user — not under the viewing team.
  const homeTeamId = String(data.team_id ?? teamId);
  const homeTeam =
    homeTeamId === teamId
      ? team
      : { name: String((await db.collection("teams").doc(homeTeamId).get()).data()?.name ?? "Team") };
  const nowComplete = !currentlyComplete;
  await db
    .collection("todos")
    .doc(todoId)
    .update({
      completed_at: nowComplete ? FieldValue.serverTimestamp() : null,
    });

  await notify({
    db,
    recipientIds: recipientsFor({
      followerIds: followerIdsOf(data),
      actorId: uid,
      visibility: data.visibility,
      ownerId: data.owner_id,
    }),
    kind: nowComplete ? "completed" : "reopened",
    ...notifyTarget(homeTeamId, homeTeam.name, todoId, data),
    actor: { id: uid },
  });
  await recordActivity({
    db,
    teamId: homeTeamId,
    entity: {
      type: "todo",
      id: todoId,
      visibility: data.visibility,
      ownerId: data.owner_id,
    },
    kind: nowComplete ? "completed" : "reopened",
    actor: { id: uid },
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
  if (data.source_rock_id) {
    // A milestone ticked from a guest team: both teams' rock lists show it.
    revalidatePath(`/teams/${teamId}/rocks`);
    if (data.team_id && data.team_id !== teamId) {
      revalidatePath(`/teams/${data.team_id}/rocks`);
    }
  }
  revalidatePath("/home");
}

// Full meta edit from the To-Dos tab drawer (list is view-first). Title
// required; empty description clears to null. Mirrors to Google Tasks using
// the (possibly new) owner.
export async function updateTodoMeta(
  teamId: string,
  todoId: string,
  formData: FormData,
) {
  const { uid, db, team } = await requireTeamAccess(teamId);
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

  const prevOwner = ownerUidOf(data) || null;
  const reassigned = owner_id !== prevOwner;

  // Followers. When the Edit form's picker was used (`followers_edited`),
  // the list is exactly what was left checked, plus the owner
  // (lib/notifications.ts applyFollowerEdit). Otherwise — an older form, or
  // a surface without the picker — the old rule holds: a new owner starts
  // following and nobody is dropped.
  let follower_ids: string[];
  let addedFollowers: string[] = [];
  let removedFollowers: string[] = [];
  if (formData.get("followers_edited") === "on") {
    const roster = new Set(
      (await getTeamMembers(teamId)).map((m) => m.user_id),
    );
    const picked = formData
      .getAll("follower_ids")
      .filter((v): v is string => typeof v === "string" && roster.has(v));
    const edit = applyFollowerEdit({
      current: followerIdsOf(data),
      ownerId: owner_id,
      picked,
      visibility,
    });
    follower_ids = edit.next;
    // The owner hears "assigned", not "added as a follower"; the actor
    // hears nothing about their own picks.
    addedFollowers = edit.added.filter((id) => id !== owner_id && id !== uid);
    removedFollowers = edit.removed;
  } else {
    follower_ids = reassigned
      ? followersAfterOwnerChange(followerIdsOf(data), owner_id)
      : followerIdsOf(data);
  }

  await db.collection("todos").doc(todoId).update({
    title,
    owner_id,
    due_date,
    description,
    visibility,
    weekly_focus: formData.get("weekly_focus") === "on",
    follower_ids,
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

  // Tell followers what moved. The new owner hears "assigned you" instead of
  // the generic summary; the actor hears nothing either way.
  const names = await loadUserNames(db, [
    owner_id,
    ...addedFollowers,
    ...removedFollowers,
  ]);
  const summary = summarizeTodoChanges(
    {
      title: String(data.title ?? ""),
      owner_id: prevOwner,
      due_date: (data.due_date as string | null) ?? null,
    },
    { title, owner_id, due_date },
    (id) => names.get(id),
    formatDateOnly,
  );
  if (summary) {
    const target = notifyTarget(teamId, team.name, todoId, { title });
    const recipients = recipientsFor({
      followerIds: follower_ids,
      actorId: uid,
      visibility,
      ownerId: owner_id,
    });
    const assigned = reassigned && owner_id !== uid ? [owner_id] : [];
    await notify({
      db,
      recipientIds: assigned,
      kind: "assigned",
      ...target,
      actor: { id: uid },
      detail: due_date ? `Due ${formatDateOnly(due_date)}` : null,
    });
    await notify({
      db,
      recipientIds: recipients.filter((id) => !assigned.includes(id)),
      kind: "updated",
      ...target,
      actor: { id: uid },
      detail: summary,
    });
  }
  if (addedFollowers.length > 0) {
    await notify({
      db,
      recipientIds: addedFollowers,
      kind: "following",
      ...notifyTarget(teamId, team.name, todoId, { title }),
      actor: { id: uid },
      detail: due_date ? `Due ${formatDateOnly(due_date)}` : null,
    });
  }

  // The trace records every change the form made, told or not.
  const entity = {
    type: "todo" as const,
    id: todoId,
    visibility,
    ownerId: owner_id,
  };
  const actor = { id: uid };
  if (summary) {
    await recordActivity({ db, teamId, entity, kind: "updated", actor, detail: summary });
  }
  const prevDescription =
    normalizeDescription(String(data.description ?? "")) || null;
  if (prevDescription !== description) {
    await recordActivity({ db, teamId, entity, kind: "description", actor });
  }
  if (addedFollowers.length > 0) {
    await recordActivity({
      db,
      teamId,
      entity,
      kind: "followers_added",
      actor,
      detail: joinNames(addedFollowers, (id) => names.get(id)),
    });
  }
  if (removedFollowers.length > 0) {
    await recordActivity({
      db,
      teamId,
      entity,
      kind: "followers_removed",
      actor,
      detail: joinNames(removedFollowers, (id) =>
        id === uid ? "you" : names.get(id),
      ),
    });
  }

  revalidatePath(pathFor(teamId));
  revalidatePath("/home");
}

/**
 * Follow or unfollow a to-do — the explicit half of the follow relation
 * (creator and owner follow automatically; anyone else on the team opts in
 * from the row, and anyone can opt out).
 *
 * Any member may follow any team-visible to-do. A private to-do is readable
 * by its owner only, so following one you don't own would subscribe you to
 * rows you can't open; the notification fan-out already filters that
 * (recipientsFor), so this only refuses the obvious case.
 */
export async function setTodoFollowing(
  teamId: string,
  todoId: string,
  following: boolean,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  if (data.visibility === "private" && ownerUidOf(data) !== uid) {
    throw new Error("Only the owner can follow a private to-do");
  }
  await db
    .collection("todos")
    .doc(todoId)
    .update({ follower_ids: toggleFollower(followerIdsOf(data), uid, following) });
  await recordActivity({
    db,
    teamId,
    entity: {
      type: "todo",
      id: todoId,
      visibility: data.visibility,
      ownerId: data.owner_id,
    },
    kind: following ? "followed" : "unfollowed",
    actor: { id: uid },
  });
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

/**
 * Toggle a to-do's weekly-focus flag.
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
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  await db.collection("todos").doc(todoId).update({ weekly_focus: next });
  await recordActivity({
    db,
    teamId,
    entity: {
      type: "todo",
      id: todoId,
      visibility: data.visibility,
      ownerId: data.owner_id,
    },
    kind: next ? "weekly_focus_on" : "weekly_focus_off",
    actor: { id: uid },
  });
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
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "todos", todoId, teamId);
  const data = snap.data() ?? {};
  if (data.source_rock_id) {
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
  await recordActivity({
    db,
    teamId,
    entity: {
      type: "todo",
      id: todoId,
      visibility: data.visibility,
      ownerId: data.owner_id,
    },
    kind: archived ? "archived" : "restored",
    actor: { id: uid },
  });
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
