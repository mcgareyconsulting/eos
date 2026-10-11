// Shape A — team item (docs/PERMISSIONS_SPEC.md §3, §3.1): issue, headline,
// team to-do.
//
// Current production behaviour: every action on these is the team gate —
// `requireTeamAccess(teamId)` (rostered, or org admin) plus
// `requireTeamDoc(...)` (the doc's `team_id` is that team). The to-do
// mutations additionally run `canMutateTodo` (lib/todo-access.ts), which is a
// no-op for a team-visible to-do and is kept in the chain here so the two
// can't drift.

import { canMutateTodo, type TodoAccessCaller, type TodoAccessSubject } from "@/lib/todo-access";
import {
  isLeaderOf,
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
  // SPEC P5: issues become followable (follow = canSee, owner + assigner
  // locked in). Today only to-dos carry `follower_ids`.
  canFollow: () => false,
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
  // SPEC P5: headlines become followable; the creator is the locked owner.
  canFollow: () => false,
  // SPEC P9: mentions on headlines (needs the thread first).
  canMention: (item, person) => gate(item, person),
  canDelete: (item, viewer) => gate(item, viewer) && item.broadcast !== true,
  /** Mark discussed / archive — allowed on broadcast copies too. */
  canComplete: gate,
};

/** Shape A for a to-do whose `visibility` is not `"private"`. */
export const teamTodoAccess: CompletableAccessModule<TeamTodoSubject> = {
  // SPEC P8: the assignee (owner_id) sees the full to-do from any team
  // (spec §3.1, D1). Today an off-team assignee can't open it.
  canSee: gate,
  canEdit: (item, viewer) =>
    gate(item, viewer) &&
    canMutateTodo(item, todoCallerFor(viewer, item.team_id)),
  // SPEC P8: the assignee can comment from any team.
  canComment: gate,
  // SPEC P8: follow = canSee, so an off-team assignee may follow.
  canFollow: gate,
  // SPEC P9: refuse mentions of people who can't see it. Today mentions
  // resolve against the viewing team's roster and are never refused.
  canMention: (item, person) => gate(item, person),
  canDelete: (item, viewer) =>
    gate(item, viewer) &&
    canMutateTodo(item, todoCallerFor(viewer, item.team_id)),
  // SPEC P8: the assignee can tick it from any team (open-by-id route).
  canComplete: (item, viewer) =>
    gate(item, viewer) &&
    canMutateTodo(item, todoCallerFor(viewer, item.team_id)),
};
