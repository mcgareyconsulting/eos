"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { getTeamMembers } from "@/lib/firebase/teams";
import { canSeeItem, loadItem, loadViewer } from "@/lib/firebase/items";
import {
  labelNotifications,
  peekItem,
  type ItemPeek,
  type NotificationLabel,
} from "@/lib/firebase/item-peek";
import type { ItemRef } from "@/lib/item-registry";
import type { TodoBoardDoc } from "@/app/(app)/teams/[teamId]/todos/todos-board";

/** Admin-SDK Timestamp → millis, so the value can cross the RSC boundary. */
function toMillis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : null;
}

/** What the hub's peek modal needs to render one to-do row in place. */
export type TodoPeek = {
  todo: TodoBoardDoc;
  teamName: string;
  members: { user_id: string; full_name: string }[];
};

/**
 * The to-do (or milestone) behind a notification, for opening it in place
 * rather than leaving the hub. Gated by `accessFor(type).canSee` at open
 * time (spec §5.3) — a to-do on another team than the row says, or one the
 * caller can no longer see, is null, which the modal renders as
 * NO_ACCESS_TEXT. A milestone's off-team assignee passes through the rock
 * rule (`hasFullRockView` counts milestone owners).
 */
export async function loadTodoPeek(
  teamId: string,
  todoId: string,
): Promise<TodoPeek | null> {
  const { uid, db, isAdmin } = await requireFirebaseUser();
  const item = await loadItem(db, { type: "todo", id: todoId });
  if (!item || item.teamId !== teamId) return null;
  const viewer = await loadViewer(db, uid, isAdmin);
  if (!canSeeItem(item, viewer)) return null;
  const d = item.data;
  const [members, teamSnap] = await Promise.all([
    getTeamMembers(teamId),
    db.collection("teams").doc(teamId).get(),
  ]);
  return {
    teamName: String(teamSnap.data()?.name ?? "Team"),
    members: members.map((m) => ({ user_id: m.user_id, full_name: m.full_name })),
    todo: {
      id: todoId,
      title: String(d.title ?? ""),
      description: (d.description as string | null) ?? null,
      owner_id: (d.owner_id as string | null) ?? null,
      due_date: (d.due_date as string | null) ?? null,
      completed_at: toMillis(d.completed_at),
      archived_at: toMillis(d.archived_at),
      visibility: d.visibility === "private" ? "private" : "team",
      weekly_focus: d.weekly_focus === true,
      source_rock_id: (d.source_rock_id as string | null) ?? null,
      follower_ids: Array.isArray(d.follower_ids)
        ? (d.follower_ids as string[])
        : null,
      assigned_by: (d.assigned_by as string | null) ?? null,
      created_by: (d.created_by as string | null) ?? null,
    },
  };
}

/**
 * Title + snippet of any item, rendered at open time through `canSee`
 * (spec §5.3). Denied and missing both return `{ access: "none" }`, which
 * the hub shows as NO_ACCESS_TEXT.
 */
export async function loadItemPeek(ref: ItemRef): Promise<ItemPeek> {
  const { uid, db, isAdmin } = await requireFirebaseUser();
  const viewer = await loadViewer(db, uid, isAdmin);
  return peekItem(db, ref, viewer);
}

/**
 * Labels (actor name + access-checked peek) for rows of the caller's that
 * arrived over the live listener after the server's first paint.
 */
export async function loadNotificationLabels(
  rowIds: string[],
): Promise<Record<string, NotificationLabel>> {
  if (!Array.isArray(rowIds)) return {};
  const { uid, db, isAdmin } = await requireFirebaseUser();
  const viewer = await loadViewer(db, uid, isAdmin);
  return labelNotifications(
    db,
    viewer,
    rowIds.filter((x): x is string => typeof x === "string"),
  );
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
