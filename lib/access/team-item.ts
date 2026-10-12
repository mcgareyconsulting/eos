// Shape A — team item (docs/PERMISSIONS_SPEC.md §3, §3.1): issue, headline,
// team to-do.
//
// Issues and headlines: every action is the team gate —
// `requireTeamAccess(teamId)` (rostered, or org admin) plus
// `requireTeamDoc(...)` (the doc's `team_id` is that team).
//
// Team to-dos (P8a): the team gate, plus the assignee from any team, who may
// see, complete, comment and follow. The to-do actions ask this module
// through `requireTodoAccess` (lib/firebase/todo-gate.ts).

import type { TodoAccessCaller, TodoAccessSubject } from "@/lib/todo-access";
import {
  isLeaderOf,
  isViewer,
  passesTeamGate,
  type CompletableAccessModule,
  type Viewer,
} from "./types";

/** The fields every team item has. */
export type TeamItemSubject = {
  team_id: string;
  owner_id?: string | null;
};

export type IssueSubject = TeamItemSubject;

export type HeadlineSubject = {
  team_id: string;
  /** A headline's owner is its creator (spec §5.0). */
  created_by?: string | null;
  /**
   * An org-wide cascade, fanned out as one doc per team. Its text belongs to
   * whoever cascaded it: the receiving team may mark it discussed or archive
   * its copy, but not edit or delete it (headlines/actions.ts).
   */
  broadcast?: boolean | null;
};

export type TeamTodoSubject = TeamItemSubject & TodoAccessSubject;

/**
 * The `TodoAccessCaller` the to-do actions build for a viewer acting on a
 * to-do filed under `teamId`. The actions pass the caller's role on the
 * team they were invoked from, and they only reach `canMutateTodo` after
 * `requireTeamDoc` proved the to-do is on that team — so "role on the
 * to-do's team" is the same value.
 */
export function todoCallerFor(viewer: Viewer, teamId: string): TodoAccessCaller {
  return {
    uid: viewer.uid,
    isAdmin: viewer.isAdmin,
    membershipRole: isLeaderOf(viewer, teamId)
      ? "leader"
      : viewer.teamIds.has(teamId)
        ? "member"
        : null,
  };
}

function gate(item: { team_id: string }, viewer: Viewer): boolean {
  return passesTeamGate(viewer, item.team_id);
}

export const issueAccess: CompletableAccessModule<IssueSubject> = {
  canSee: gate,
  canEdit: gate,
  canComment: gate,
  // Spec §5.3: follow = canSee (owner + assigner locked, lib/follow.ts).
  canFollow: gate,
  // SPEC P9: mentions on every item type, refused server-side unless the
  // person canSee. Today mentions are parsed on to-do comments only.
  canMention: (item, person) => gate(item, person),
  canDelete: gate,
  /** Solve / reopen / archive (setIssueStatus, setIssueArchived). */
  canComplete: gate,
};

export const headlineAccess: CompletableAccessModule<HeadlineSubject> = {
  canSee: gate,
  canEdit: (item, viewer) => gate(item, viewer) && item.broadcast !== true,
  // SPEC P9: headlines get a thread (spec §5.1). Today `entity_comments`
  // accepts only issue / rock / todo.
  canComment: () => false,
  // Spec §5.3: follow = canSee; the creator is the locked owner.
  canFollow: gate,
  // SPEC P9: mentions on headlines (needs the thread first).
  canMention: (item, person) => gate(item, person),
  canDelete: (item, viewer) => gate(item, viewer) && item.broadcast !== true,
  /** Mark discussed / archive — allowed on broadcast copies too. */
  canComplete: gate,
};

/** Parent team, admins, or the assignee (`owner_id`) from any team. */
function seesTeamTodo(item: TeamTodoSubject, viewer: Viewer): boolean {
  return gate(item, viewer) || isViewer(viewer, item.owner_id);
}

/**
 * Shape A for a to-do whose `visibility` is not `"private"`. A member may
 * assign it to a person on any team (spec §3.1); that assignee sees the full
 * to-do and its thread from any team (D1), completes it, comments and
 * follows. Editing, archiving and deleting stay with the parent team and
 * admins.
 */
export const teamTodoAccess: CompletableAccessModule<TeamTodoSubject> = {
  canSee: seesTeamTodo,
  canEdit: gate,
  canComment: seesTeamTodo,
  // Spec §5.3: follow = canSee.
  canFollow: seesTeamTodo,
  // SPEC P9: refuse mentions of people who can't see it. Today mentions
  // resolve against the to-do team's roster and are never refused.
  canMention: (item, person) => seesTeamTodo(item, person),
  canDelete: gate,
  canComplete: seesTeamTodo,
};
