"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { getTeamMembers, requireTeamAccess } from "@/lib/firebase/teams";
import type { TodoBoardDoc } from "@/app/(app)/teams/[teamId]/todos/todos-board";
import type { IssueDetailData } from "@/app/(app)/teams/[teamId]/issues/issue-detail-modal";

/** Admin-SDK Timestamp → millis, so the value can cross the RSC boundary. */
function toMillis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : null;
}

/** What the hub's peek modal needs to render one to-do row in place. */
export type TodoPeek = {
  todo: TodoBoardDoc;
  members: { user_id: string; full_name: string }[];
};

/**
 * The to-do behind a notification, for opening it in place rather than
 * leaving the hub. Same visibility contract as the To-Dos page's `?todo=`
 * deep link: a row on another team, or someone else's private to-do, is
 * "not found" rather than forbidden. Membership is enforced by
 * requireTeamAccess, which throws for a team the caller has left — the
 * modal treats that as gone too.
 */
export async function loadTodoPeek(
  teamId: string,
  todoId: string,
): Promise<TodoPeek | null> {
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await db.collection("todos").doc(todoId).get();
  const d = snap.data();
  if (!snap.exists || !d || d.team_id !== teamId) return null;
  if (d.visibility === "private" && d.owner_id !== uid) return null;
  const members = (await getTeamMembers(teamId)).map((m) => ({
    user_id: m.user_id,
    full_name: m.full_name,
  }));
  return {
    todo: {
      id: snap.id,
      title: String(d.title ?? ""),
      description: (d.description as string | null) ?? null,
      owner_id: (d.owner_id as string | null) ?? null,
      due_date: (d.due_date as string | null) ?? null,
      completed_at: toMillis(d.completed_at),
      archived_at: toMillis(d.archived_at),
      visibility: d.visibility === "private" ? "private" : "team",
      weekly_focus: d.weekly_focus === true,
      source_rock_id: (d.source_rock_id as string | null) ?? null,
      follower_ids: Array.isArray(d.follower_ids) ? d.follower_ids : null,
    },
    members,
  };
}

/** What the hub's peek modal needs to render one issue in place. */
export type IssuePeek = {
  issue: IssueDetailData;
  ownerId: string | null;
  members: { user_id: string; full_name: string }[];
};

/**
 * The issue behind a notification, for opening it in place. Same posture as
 * `loadTodoPeek`: an issue on another team is "not found" rather than
 * forbidden, and a team the caller has left throws in requireTeamAccess.
 */
export async function loadIssuePeek(
  teamId: string,
  issueId: string,
): Promise<IssuePeek | null> {
  const { db } = await requireTeamAccess(teamId);
  const snap = await db.collection("issues").doc(issueId).get();
  const d = snap.data();
  if (!snap.exists || !d || d.team_id !== teamId) return null;
  const members = (await getTeamMembers(teamId)).map((m) => ({
    user_id: m.user_id,
    full_name: m.full_name,
  }));
  return {
    issue: {
      id: snap.id,
      title: String(d.title ?? ""),
      description: (d.description as string | null) ?? null,
      priority: (d.priority as IssueDetailData["priority"]) ?? null,
      votes: Number(d.votes ?? 0),
      type: d.type === "long" ? "long" : "short",
      status: (d.status as IssueDetailData["status"]) ?? "open",
      follower_ids: Array.isArray(d.follower_ids) ? d.follower_ids : null,
    },
    ownerId: (d.owner_id as string | null) ?? null,
    members,
  };
}

/**
 * Mark one of the caller's notifications read. A row belonging to someone
 * else is treated as not found rather than forbidden, so ids stay
 * unenumerable — the same posture requireTeamDoc takes.
 */
export async function markNotificationRead(id: string) {
  const { uid, db } = await requireFirebaseUser();
  const ref = db.collection("notifications").doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.user_id !== uid) return;
  if (snap.data()?.read_at != null) return;
  await ref.update({ read_at: FieldValue.serverTimestamp() });
  revalidatePath("/notifications");
}

/** One of the caller's rows, or null — the not-found posture shared below. */
async function ownRow(id: string) {
  const { uid, db } = await requireFirebaseUser();
  const ref = db.collection("notifications").doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.user_id !== uid) return null;
  return { ref, data: snap.data() ?? {} };
}

/**
 * Archive one notification — the row's ✕. Same idea as an archived to-do:
 * it leaves the inbox, keeps its read/unread state, and stays findable on
 * the Archived tab. Rows are never hidden just by being read; this and
 * "Archive read" are the only ways one leaves the inbox.
 */
export async function archiveNotification(id: string) {
  const row = await ownRow(id);
  if (!row || row.data.archived_at != null) return;
  await row.ref.update({ archived_at: FieldValue.serverTimestamp() });
  revalidatePath("/notifications");
}

/** Back to the inbox. */
export async function restoreNotification(id: string) {
  const row = await ownRow(id);
  if (!row || row.data.archived_at == null) return;
  await row.ref.update({ archived_at: null });
  revalidatePath("/notifications");
}

/** Permanent. Only from the Archived tab — the inbox never deletes. */
export async function deleteNotification(id: string) {
  const row = await ownRow(id);
  if (!row || row.data.archived_at == null) return;
  await row.ref.delete();
  revalidatePath("/notifications");
}

/** Archive every read row still in the inbox — "Archive read". */
export async function archiveReadNotifications() {
  const { uid, db } = await requireFirebaseUser();
  // Filtered in code rather than with `read_at != null`: an inequality on
  // a second field needs a composite index the deploy doesn't carry, and
  // one person's inbox is small enough to read whole. `archived_at` is
  // absent on rows written before the tab existed, so "not archived" is
  // `== null`, which is true for undefined too.
  const snap = await db
    .collection("notifications")
    .where("user_id", "==", uid)
    .get();
  const docs = snap.docs.filter(
    (d) => d.data().read_at != null && d.data().archived_at == null,
  );
  if (docs.length === 0) return 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) {
      batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  revalidatePath("/notifications");
  return docs.length;
}

/** Mark everything unread for the caller as read, in one batch. */
export async function markAllNotificationsRead() {
  const { uid, db } = await requireFirebaseUser();
  const snap = await db
    .collection("notifications")
    .where("user_id", "==", uid)
    .where("read_at", "==", null)
    .get();
  if (snap.empty) return 0;
  // Batches cap at 500 writes; chunk in case a long-idle inbox exceeds it.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) {
      batch.update(d.ref, { read_at: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  revalidatePath("/notifications");
  return docs.length;
}
