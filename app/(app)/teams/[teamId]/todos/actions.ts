"use server";

import { revalidatePath } from "next/cache";
import { LONG_TEXT_MAX, TITLE_MAX, requireMaxLength } from "@/lib/text-limits";
import { notFound } from "next/navigation";
import { FieldValue } from "firebase-admin/firestore";
import {
  getOrgTeams,
  getTeamMembers,
  requireTeamAccess,
  requireTeamDoc,
} from "@/lib/firebase/teams";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import {
  requireAssignablePerson,
  requireTodoAccess,
} from "@/lib/firebase/todo-gate";
import { rockMilestoneCompleted } from "@/lib/firebase/rock-events";
import { loadOrgPeople } from "../rocks/actions";
import { normalizeDescription } from "@/lib/csv-import";
import {
  upsertTaskForTodo,
  deleteTaskForTodo,
  type TodoMirror,
} from "@/lib/google/tasks";
import { selectTodosClosedByMeetingEnd } from "@/lib/todos-archive";
import { canChangeTodoVisibility } from "@/lib/todo-access";
import { emitEvent } from "@/lib/firebase/notifications";
import { purgeItem } from "@/lib/firebase/purge";
import { recordActivity } from "@/lib/firebase/activity";
import { autoArchiveActivity, joinNames } from "@/lib/activity";
import { loadUserNames } from "@/lib/firebase/user-names";
import { formatDateOnly } from "@/lib/dates";
import {
  addedFollowerRecipients,
  assignmentRecipients,
  applyFollowerEdit,
  initialFollowers,
  summarizeTodoChanges,
  todoEditEvents,
} from "@/lib/notifications";
import {
  assignerOf,
  assignmentPatch,
  followersAfterAccessChange,
} from "@/lib/follow";
import { todoAccess } from "@/lib/access";
import { loadViewers } from "@/lib/firebase/items";
import { setFollowing } from "../follow/actions";

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

/**
 * The to-do `todoId` for a change made from team `teamId`'s page: the
 * caller may `action` it (lib/firebase/todo-gate.ts — team + admins for a
 * team to-do, creator + assignee + admins for a private one) and it lives
 * on that team. 404s otherwise, like requireTeamDoc.
 */
async function requireTeamTodo(
  teamId: string,
  todoId: string,
  action: "edit" | "delete",
) {
  const gate = await requireTodoAccess(todoId, action);
  if (gate.teamId !== teamId) notFound();
  return gate;
}

function followerIdsOf(data: FirebaseFirestore.DocumentData): string[] {
  return Array.isArray(data.follower_ids)
    ? data.follower_ids.filter((x): x is string => typeof x === "string")
    : [];
}

/** The ref every to-do notification is keyed by (milestones reclassify on load). */
function todoRef(todoId: string) {
  return { type: "todo" as const, id: todoId };
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
  // Weekly focus. A free flag — see lib/weekly-focus.ts for why it is not
  // one-per-person, and for the L10-to-L10 week it belongs to.
  const weekly_focus = formData.get("weekly_focus") === "on";

  if (!title) throw new Error("Title required");
  requireMaxLength(title, TITLE_MAX, "Title");
  requireMaxLength(description, LONG_TEXT_MAX, "Description");
  // A member may assign a to-do to anyone in the directory (spec §2.3,
  // §3.1). The owner's Google Tasks list receives it, so the uid must still
  // be a real, active person (C-03).
  await requireAssignablePerson(db, owner_id, { self: uid });

  // Creator + owner follow from the start; that is the "assign and follow"
  // shape the client uses today (N61). "Add followers" picks ride along,
  // checked against the roster so a stale or hand-rolled form can't
  // subscribe someone who isn't on the team. A private to-do is readable by
  // its creator and owner only, so nobody else can follow it.
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
    // The creator made the assignment: a locked follower (lib/follow.ts).
    assigned_by: uid,
    follower_ids,
    created_at: FieldValue.serverTimestamp(),
  });

  const dueDetail = due_date ? `Due ${formatDateOnly(due_date)}` : null;
  const addedFollowers = addedFollowerRecipients({
    creatorId: uid,
    ownerId: owner_id,
    extraIds: picked,
  });
  await emitEvent(db, todoRef(ref.id), null, uid, {
    teamId,
    direct: {
      assigned: owner_id !== uid ? [owner_id] : [],
      following: addedFollowers,
    },
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
 * Tick or untick a to-do or milestone. Team-independent (P8a): `teamId` is
 * only the page to refresh. The gate is the item's own rule
 * (lib/firebase/todo-gate.ts) on the caller's full memberships — a team
 * to-do's parent team, its assignee from any team and admins; a private
 * to-do's creator, assignee and admins; a milestone's assignee, parent
 * team, audience and admins. A block view grants nothing beyond the
 * assignee's own tick. Admin SDK bypasses firestore.rules, so this is the
 * real gate.
 */
export async function toggleTodo(
  teamId: string,
  todoId: string,
  currentlyComplete: boolean,
) {
  const gate = await requireTodoAccess(todoId, "complete");
  const { uid, db } = gate;
  const data = gate.data as FirebaseFirestore.DocumentData;
  // Ticked from another team's page (an off-team assignee, the audience) it
  // is still an event on the to-do's own team: file the notification and
  // the activity row there, as that user — not under the viewing team.
  const homeTeamId = gate.teamId || teamId;
  const nowComplete = !currentlyComplete;
  await db
    .collection("todos")
    .doc(todoId)
    .update({
      completed_at: nowComplete ? FieldValue.serverTimestamp() : null,
    });
  // A milestone done is also an event on its rock (spec §5.3). Only when
  // the rock still exists (loadItem classified it as a milestone).
  const rockId =
    gate.item.ref.type === "milestone" ? String(data.source_rock_id ?? "") : "";
  if (nowComplete && rockId) {
    await rockMilestoneCompleted(db, rockId, uid, homeTeamId);
  }

  await emitEvent(db, todoRef(todoId), nowComplete ? "completed" : "reopened", uid, {
    teamId: homeTeamId,
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
  if (homeTeamId !== teamId) {
    revalidatePath(pathFor(homeTeamId));
    revalidatePath(`/teams/${homeTeamId}/meetings`);
  }
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
  const { uid, db, data, item } = await requireTeamTodo(
    teamId,
    todoId,
    "edit",
  );
  // A milestone is a todos doc too; locked followers follow its registry entry.
  const itemType = item.ref.type;

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

  requireMaxLength(title, TITLE_MAX, "Title");
  requireMaxLength(description, LONG_TEXT_MAX, "Description");

  // Spec §3.2: only the creator or the assignee may publish a private
  // to-do to the team — not an admin, not a leader.
  if (!canChangeTodoVisibility(data, { uid }, visibility)) {
    throw new Error(
      "Only the person who created this to-do or its owner can share it with the team",
    );
  }

  const prevOwner = ownerUidOf(data) || null;
  const reassigned = owner_id !== prevOwner;
  // Org-wide assignment (spec §3.1): any active directory person.
  await requireAssignablePerson(db, owner_id, { self: uid, keep: prevOwner });

  // Assignment (lib/follow.ts): a new owner makes the caller the assigner;
  // new owner + new assigner lock, the old ones stay as plain followers.
  const assignment = assignmentPatch(itemType, data, owner_id, uid);

  // Followers. When the Edit form's picker was used (`followers_edited`),
  // the list is exactly what was left checked, plus the locked followers
  // (lib/notifications.ts applyFollowerEdit) — and, on a reassignment, the
  // old owner and assigner, who stay followers until they unfollow
  // themselves. Otherwise — an older form, or a surface without the picker
  // — nobody is dropped.
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
      lockedIds: [
        assignment.assigned_by,
        ...(reassigned ? [prevOwner, assignerOf(itemType, data)] : []),
      ],
      picked,
      visibility,
    });
    follower_ids = edit.next;
    // The owner hears "assigned", not "added as a follower"; the actor
    // hears nothing about their own picks.
    addedFollowers = edit.added.filter((id) => id !== owner_id && id !== uid);
    removedFollowers = edit.removed;
  } else {
    follower_ids = assignment.follower_ids;
  }

  // Team -> private: drop followers who can no longer see it (only the
  // creator, the assignee and admins can). Private -> team adds nobody back.
  if (visibility === "private" && data.visibility !== "private") {
    const next = {
      ...data,
      team_id: String(data.team_id ?? teamId),
      owner_id,
      visibility,
      assigned_by: assignment.assigned_by,
    };
    const candidates = [...new Set([...follower_ids, ...followerIdsOf(data)])];
    const viewers = await loadViewers(db, candidates);
    follower_ids = followersAfterAccessChange(
      itemType,
      { ...next, follower_ids: candidates },
      (id) => {
        const v = viewers.get(id);
        return !!v && todoAccess.canSee(next, v);
      },
    );
  }

  await db.collection("todos").doc(todoId).update({
    title,
    owner_id,
    due_date,
    description,
    visibility,
    weekly_focus: formData.get("weekly_focus") === "on",
    follower_ids,
    assigned_by: assignment.assigned_by,
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

  // Tell followers what moved (spec §5.3: title, due date, description,
  // reassigned) — one row per person, for the most significant change. The
  // new owner hears "assigned you"; added followers hear "added you"; the
  // actor hears nothing. Rows are pointers: the summary is not copied in.
  const prevDescription =
    normalizeDescription(String(data.description ?? "")) || null;
  const [event] = todoEditEvents(
    {
      title: String(data.title ?? ""),
      owner_id: prevOwner,
      due_date: (data.due_date as string | null) ?? null,
      description: prevDescription,
    },
    { title, owner_id, due_date, description },
  );
  const who = assignmentRecipients({
    prevOwnerId: prevOwner,
    nextOwnerId: owner_id,
    actorId: uid,
  });
  if (event || addedFollowers.length > 0 || reassigned) {
    await emitEvent(db, todoRef(todoId), event ?? null, uid, {
      // File under the to-do's own team, not the page it was edited from.
      teamId: item.teamId || teamId,
      direct: {
        assigned: who.assigned,
        unassigned: who.unassigned,
        following: addedFollowers,
      },
    });
  }

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
 * Follow or unfollow a to-do (or milestone) — the to-do row's Follow
 * control. A thin alias for the generic `setFollowing` (follow/actions.ts):
 * gated by `canFollow`, and the owner and current assigner cannot unfollow.
 */
export async function setTodoFollowing(
  teamId: string,
  todoId: string,
  following: boolean,
) {
  await setFollowing(todoRef(todoId), teamId, following);
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
  const { uid, db, data } = await requireTeamTodo(teamId, todoId, "edit");
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
  const { db, data } = await requireTeamTodo(teamId, todoId, "delete");
  await db.collection("todos").doc(todoId).delete();
  // Spec §5.1: its thread, notifications and activity trace go with it.
  await purgeItem(db, { type: data.source_rock_id ? "milestone" : "todo", id: todoId });
  await deleteTaskForTodo(ownerUidOf(data), data.google_task_id);
  revalidatePath(pathFor(teamId));
}

/**
 * Soft-archive or restore a pure to-do (not rock milestones).
 *
 * Archiving one that is still open closes it first: it lands in Archived
 * reading "Closed <date>", which has to be true, and both sweeps define a
 * sweepable to-do as one carrying `completed_at`. So the archive is a
 * completion plus an archive — followers hear about it, the trace records
 * both, and Google Tasks sees the check — and restore reverses both halves.
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
  const { uid, db, data } = await requireTeamTodo(teamId, todoId, "edit");
  if (data.source_rock_id) {
    throw new Error("Milestones are managed under Rocks, not archived here");
  }
  // Archiving something nobody checked off: close it in the same write.
  const closingNow = archived && data.completed_at == null;
  await db
    .collection("todos")
    .doc(todoId)
    .update(
      archived
        ? closingNow
          ? {
              completed_at: FieldValue.serverTimestamp(),
              archived_at: FieldValue.serverTimestamp(),
            }
          : { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null, completed_at: null },
    );

  if (closingNow) {
    await emitEvent(db, todoRef(todoId), "completed", uid, { teamId });
    await recordActivity({
      db,
      teamId,
      entity: {
        type: "todo",
        id: todoId,
        visibility: data.visibility,
        ownerId: data.owner_id,
      },
      kind: "completed",
      actor: { id: uid },
    });
    const taskId = await upsertTaskForTodo(
      ownerUidOf(data),
      mirrorFrom(data, { completed: true }),
      data.google_task_id,
    );
    if (taskId && taskId !== data.google_task_id) {
      await db
        .collection("todos")
        .doc(todoId)
        .update({ google_task_id: taskId });
    }
  }

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
 * Archive every pure team to-do closed by the end of this L10 — in the room
 * or earlier in the week (selectTodosClosedByMeetingEnd). Called from
 * endMeeting. Each archive leaves an activity row saying the Finish did it.
 */
export async function archiveTodosAtMeetingFinish(
  teamId: string,
  meetingId: string,
): Promise<number> {
  const { db } = await requireTeamAccess(teamId);
  const meetingSnap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  const m = meetingSnap.data() ?? {};
  const endMs =
    typeof m.ended_at?.toMillis === "function"
      ? m.ended_at.toMillis()
      : Date.now();

  const snap = await db
    .collection("todos")
    .where("team_id", "==", teamId)
    .get();

  const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ids = new Set(selectTodosClosedByMeetingEnd(candidates, endMs));
  if (ids.size === 0) return 0;

  // Archive + its activity row commit together; 2 writes per to-do keeps
  // each batch under Firestore's 500.
  const due = snap.docs.filter((d) => ids.has(d.id));
  for (let i = 0; i < due.length; i += 200) {
    const batch = db.batch();
    for (const d of due.slice(i, i + 200)) {
      batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
      batch.set(
        db.collection("entity_activity").doc(),
        autoArchiveActivity(
          { id: d.id, team_id: teamId, ...d.data() },
          "finish",
          FieldValue.serverTimestamp(),
        ),
      );
    }
    await batch.commit();
  }
  revalidatePath(pathFor(teamId));
  revalidatePath("/home");
  return ids.size;
}

/**
 * The directory for the to-do owner picker (spec §2.5, §3.1): every person
 * on any roster with their teams, and every team's name. Visible to every
 * signed-in person, so no team gate. `loadOrgPeople` is the rock modal's
 * loader (P6a), reused so the two pickers list the same people.
 */
export async function loadTodoDirectory(): Promise<{
  people: { user_id: string; full_name: string; team_ids: string[] }[];
  teams: { id: string; name: string }[];
}> {
  const [people, teams] = await Promise.all([loadOrgPeople(), getOrgTeams()]);
  return { people, teams };
}

/**
 * Display names for people the viewing roster doesn't hold — an off-team
 * assignee, the assigner of a to-do from another team, a comment author on
 * a to-do thread read from outside its team. Names are directory data
 * (spec §2.5), so any signed-in person may ask.
 */
export async function loadPersonNames(
  ids: string[],
): Promise<Record<string, string>> {
  if (!Array.isArray(ids)) return {};
  const { db } = await requireFirebaseUser();
  const clean = [
    ...new Set(ids.filter((x): x is string => typeof x === "string" && !!x)),
  ];
  const names = await loadUserNames(db, clean.slice(0, 100));
  return Object.fromEntries(names);
}
