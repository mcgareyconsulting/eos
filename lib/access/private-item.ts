// Shape B — private item (docs/PERMISSIONS_SPEC.md §3, §3.2): a to-do with
// `visibility: "private"`.
//
// The creator (`created_by`), the assignee (`owner_id`) and org admins see
// it, change it, tick it, delete it, read and write its thread and follow
// it — from any team; no team gate. Leaders have no special power over it.
// Only the creator or the assignee may turn it into a team to-do (an admin
// may not). It never shows in the team's lists or L10 to anyone else (spec
// §3.2): the pages show it to the creator and the assignee only; an admin
// reaches it by link or notification.

import { canChangeTodoVisibility } from "@/lib/todo-access";
import type { TeamTodoSubject } from "./team-item";
import { isViewer, type CompletableAccessModule, type Viewer } from "./types";

export type PrivateTodoSubject = TeamTodoSubject & {
  /** Stored since the follow feature; absent on older docs and imports. */
  created_by?: string | null;
};

/** The creator or the assignee (no admin). */
export function isPrivateTodoParty(item: PrivateTodoSubject, viewer: Viewer): boolean {
  return isViewer(viewer, item.owner_id) || isViewer(viewer, item.created_by);
}

function party(item: PrivateTodoSubject, viewer: Viewer): boolean {
  return viewer.isAdmin || isPrivateTodoParty(item, viewer);
}

export const privateTodoAccess: CompletableAccessModule<PrivateTodoSubject> & {
  /** Publish it as a team to-do. */
  canChangeVisibility(item: PrivateTodoSubject, viewer: Viewer): boolean;
} = {
  canSee: party,
  canEdit: party,
  canComment: party,
  // Spec §5.3: follow = canSee.
  canFollow: party,
  // Spec §5.2: refused server-side unless the person canSee.
  canMention: party,
  canDelete: party,
  canComplete: party,
  canChangeVisibility: (item, viewer) =>
    canChangeTodoVisibility(item, viewer, "team"),
};
