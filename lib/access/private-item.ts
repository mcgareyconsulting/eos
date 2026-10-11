// Shape B — private item (docs/PERMISSIONS_SPEC.md §3, §3.2): a to-do with
// `visibility: "private"`.
//
// Current production behaviour (main @ 2b1eb5c):
//   - See: the owner only, on the To-Dos page and Home of a team they can
//     open (todos/page.tsx, home/page.tsx filter `owner_id === uid`).
//     firestore.rules also lets admins read it client-side, but no page
//     shows an admin someone else's private to-do.
//   - Change / tick / delete / publish: owner, a leader of the to-do's team,
//     or an org admin (`canMutateTodo`, lib/todo-access.ts), behind the
//     team gate.
//   - Comment / follow: the owner only (entity-comments/actions.ts,
//     todos/actions.ts setTodoFollowing) — admins included in the refusal.

import { canMutateTodo } from "@/lib/todo-access";
import { todoCallerFor, type TeamTodoSubject } from "./team-item";
import {
  isViewer,
  passesTeamGate,
  type CompletableAccessModule,
  type Viewer,
} from "./types";

export type PrivateTodoSubject = TeamTodoSubject & {
  /** Stored since the follow feature; absent on older docs and imports. */
  created_by?: string | null;
};

/** The owner, acting through a team they can open. */
function ownerThroughGate(item: PrivateTodoSubject, viewer: Viewer): boolean {
  return isViewer(viewer, item.owner_id) && passesTeamGate(viewer, item.team_id);
}

function mutable(item: PrivateTodoSubject, viewer: Viewer): boolean {
  // SPEC P8: creator + assignee + admin only; leaders lose their power over
  // private to-dos (spec §3.2, change 3). Today the creator has no access
  // unless they own it, and a leader of the team does.
  return (
    passesTeamGate(viewer, item.team_id) &&
    canMutateTodo(item, todoCallerFor(viewer, item.team_id))
  );
}

export const privateTodoAccess: CompletableAccessModule<PrivateTodoSubject> & {
  /** Publish it as a team to-do (or back). */
  canChangeVisibility(item: PrivateTodoSubject, viewer: Viewer): boolean;
} = {
  // SPEC P8: creator + assignee + admins see it (spec §3, shape B). Today:
  // the owner only — not the creator, not admins (in pages).
  canSee: ownerThroughGate,
  canEdit: mutable,
  // SPEC P8: creator + assignee + admins read and write the thread.
  canComment: ownerThroughGate,
  // SPEC P8: follow = canSee (creator + assignee + admins).
  canFollow: ownerThroughGate,
  // SPEC P9: mentions refused server-side unless the person canSee. Today
  // only the owner is ever notified (lib/notifications.ts recipientsFor).
  canMention: ownerThroughGate,
  canDelete: mutable,
  canComplete: mutable,
  // SPEC P8: only the creator or the assignee may turn a private to-do into
  // a team to-do (spec §3.2). Today anyone who can mutate it can.
  canChangeVisibility: mutable,
};
