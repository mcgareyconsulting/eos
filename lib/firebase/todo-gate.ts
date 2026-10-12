// The to-do server gate (docs/PERMISSIONS_SPEC.md §3, §3.1, §3.2, §3.3; P8a).
//
// Team-independent: a to-do is judged by its own fields and the caller's
// full memberships, not by the team page the action was invoked from. That
// is what lets an off-team assignee open, complete and comment on their
// to-do (D1). Milestones (`todos` docs with `source_rock_id`) go through
// the rock rule (`milestoneAccess`). The Admin SDK bypasses
// firestore.rules, so these checks are the real gate.

import { notFound } from "next/navigation";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { milestoneAccess, todoAccess, type MilestoneSubject, type TodoSubject, type Viewer } from "@/lib/access";
import { requireFirebaseUser } from "./auth";
import { loadItem, loadViewer, type LoadedItem } from "./items";

export type TodoAction = "see" | "complete" | "comment" | "follow" | "edit" | "delete";

/** May `viewer` do `action` on a loaded to-do or milestone? Pure. */
export function todoCan(item: LoadedItem, viewer: Viewer, action: TodoAction): boolean {
  if (item.ref.type === "milestone") {
    const s = item.subject as MilestoneSubject;
    const m = milestoneAccess;
    switch (action) {
      case "see":
        return m.canSee(s, viewer);
      case "complete":
        return m.canComplete(s, viewer);
      case "comment":
        return m.canComment(s, viewer);
      case "follow":
        return m.canFollow(s, viewer);
      case "edit":
        return m.canEdit(s, viewer);
      case "delete":
        return m.canDelete(s, viewer);
    }
  }
  if (item.ref.type !== "todo") return false;
  const s = item.subject as TodoSubject;
  const t = todoAccess;
  switch (action) {
    case "see":
      return t.canSee(s, viewer);
    case "complete":
      return t.canComplete(s, viewer);
    case "comment":
      return t.canComment(s, viewer);
    case "follow":
      return t.canFollow(s, viewer);
    case "edit":
      return t.canEdit(s, viewer);
    case "delete":
      return t.canDelete(s, viewer);
  }
}

export type TodoGate = {
  uid: string;
  isAdmin: boolean;
  db: Firestore;
  viewer: Viewer;
  item: LoadedItem;
  /** The to-do doc's stored fields. */
  data: DocumentData;
  /** The to-do's own team (`team_id`) — where its thread, activity and
   *  notifications are filed, whichever page the action came from. */
  teamId: string;
};

/**
 * Load the to-do `todoId` for the signed-in caller and require `action`.
 * Missing and forbidden both 404 (ids stay unenumerable — requireTeamDoc's
 * posture).
 */
export async function requireTodoAccess(
  todoId: string,
  action: TodoAction,
): Promise<TodoGate> {
  if (typeof todoId !== "string" || !todoId) notFound();
  const { uid, isAdmin, db } = await requireFirebaseUser();
  const item = await loadItem(db, { type: "todo", id: todoId });
  if (!item) notFound();
  const viewer = await loadViewer(db, uid, isAdmin);
  if (!todoCan(item, viewer, action)) notFound();
  return { uid, isAdmin, db, viewer, item, data: item.data, teamId: item.teamId };
}

export const ASSIGNEE_NOT_IN_DIRECTORY = "Choose an owner from the directory.";
export const ASSIGNEE_DEACTIVATED = "That person is deactivated; choose another owner.";

/**
 * Throws unless `ownerId` is an active directory person (spec §2.3, §3.1: a
 * member may assign a to-do to a person on any team). Replaces the roster
 * check (`requireRosterOwner`) for to-dos. Owner ids arrive as raw form
 * strings and the owner's Google Tasks list receives the to-do (C-03), so
 * an arbitrary uid must still be refused.
 *
 * Active = a `users` profile without `deactivated_at`, or — for a person
 * rostered before profiles existed — a `team_members` row and no profile.
 * A deactivated profile is refused even if a stale roster row remains.
 * Passes without a read for the caller themself (`self`) and for the owner
 * the to-do already carries (`keep`), so re-saving is never blocked.
 */
export async function requireAssignablePerson(
  db: Firestore,
  ownerId: string,
  opts: { self?: string; keep?: string | null } = {},
): Promise<void> {
  if (!ownerId) throw new Error(ASSIGNEE_NOT_IN_DIRECTORY);
  if (ownerId === opts.self || ownerId === opts.keep) return;
  const profile = await db.collection("users").doc(ownerId).get();
  if (profile.exists) {
    if ((profile.data() ?? {}).deactivated_at) throw new Error(ASSIGNEE_DEACTIVATED);
    return;
  }
  const rostered = await db.collection("team_members").where("user_id", "==", ownerId).get();
  if (rostered.docs.length === 0) throw new Error(ASSIGNEE_NOT_IN_DIRECTORY);
}
