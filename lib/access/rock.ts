// Shape C — rock and milestone (docs/PERMISSIONS_SPEC.md §3, §3.3, §4).
//
// The source of truth for who may see and change a rock (P6a). Pages,
// server actions and lib/rocks-share.ts (placement, blocks, save review)
// all ask this module; nothing re-derives the rules.
//
// The model, in one paragraph: the FULL rock (every milestone, progress,
// description, status history, thread) goes to the parent team, the
// audience (`audience_team_ids` teams and `audience_user_ids` persons) and
// admins. All of them may edit the rock and its milestones, move its
// status, tick and comment. Only the parent team and admins delete it.
// Only leaders of the parent team and admins change the audience or set
// Private, which clears the audience. A milestone assignee outside that set
// sees only their milestone(s) plus the rock's headline (title, owner,
// team) and may tick their own milestone. Ownership of the rock grants
// nothing by itself (the owner must be on the parent team, so they are
// already in the full set). `milestone_owner_ids` grants nothing.

import { canMutateTodo } from "@/lib/todo-access";
import { todoCallerFor } from "./team-item";
import {
  isLeaderOf,
  isMemberOf,
  isViewer,
  passesTeamGate,
  type CompletableAccessModule,
  type AccessModule,
  type Viewer,
} from "./types";

/**
 * The stored rock fields access reads. The legacy names (`shared_team_ids`,
 * `team_only`) are read as a fallback until the P13 migration rewrites
 * every rock; a save always writes the new names and deletes the old ones.
 */
export type RockSubject = {
  team_id: string;
  owner_id: string | null;
  /** Teams in the audience: they see and edit the full rock. */
  audience_team_ids?: readonly string[] | null;
  /** Persons in the audience: they see and edit the full rock. */
  audience_user_ids?: readonly string[] | null;
  /** Private: no audience, no blocks, parent team only. */
  private?: boolean | null;
  /** Legacy name of `audience_team_ids` (read only). */
  shared_team_ids?: readonly string[] | null;
  /** Legacy "Keep on this team", read as `private` (read only). */
  team_only?: boolean | null;
};

/** What a person who sees only their milestone gets of the rock (§3.3). */
export type RockHeadline = {
  id: string;
  title: string;
  owner_id: string | null;
  team_id: string;
};

/** A milestone (a `todos` doc with `source_rock_id`) and the rock it hangs off. */
export type MilestoneSubject = {
  milestone: {
    owner_id: string | null;
    /** The milestone's `team_id` — always the rock's parent team. */
    team_id: string;
    visibility?: unknown;
  };
  rock: RockSubject;
};

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** The access fields of a stored rock doc (Admin or client SDK data). */
export function rockSubjectOf(data: Record<string, unknown> | undefined): RockSubject {
  const x = data ?? {};
  return {
    team_id: typeof x.team_id === "string" ? x.team_id : "",
    owner_id: typeof x.owner_id === "string" && x.owner_id ? x.owner_id : null,
    audience_team_ids: Array.isArray(x.audience_team_ids) ? strings(x.audience_team_ids) : null,
    audience_user_ids: Array.isArray(x.audience_user_ids) ? strings(x.audience_user_ids) : null,
    private: typeof x.private === "boolean" ? x.private : null,
    shared_team_ids: Array.isArray(x.shared_team_ids) ? strings(x.shared_team_ids) : null,
    team_only: x.team_only === true,
  };
}

/** Private (new field wins; legacy `team_only` is the fallback). */
export function isPrivateRock(rock: Pick<RockSubject, "private" | "team_only">): boolean {
  if (typeof rock.private === "boolean") return rock.private;
  return rock.team_only === true;
}

/**
 * Audience teams. `audience_team_ids` when the doc has it (even empty),
 * else the legacy `shared_team_ids`. Never the parent team. A private rock
 * has no audience whatever is stored.
 */
export function audienceTeamIdsOf(rock: RockSubject): string[] {
  if (isPrivateRock(rock)) return [];
  const raw = Array.isArray(rock.audience_team_ids)
    ? rock.audience_team_ids
    : rock.shared_team_ids;
  return [...new Set(strings(raw))].filter((id) => id !== rock.team_id);
}

/** Audience persons. A private rock has none. */
export function audienceUserIdsOf(rock: RockSubject): string[] {
  if (isPrivateRock(rock)) return [];
  return [...new Set(strings(rock.audience_user_ids))];
}

/** Is `teamId` (not the parent) in the rock's audience? */
export function isAudienceTeam(rock: RockSubject, teamId: string): boolean {
  if (rock.team_id === teamId) return false;
  return audienceTeamIdsOf(rock).includes(teamId);
}

/** Parent team, audience team, audience person, or admin. */
export function seesFullRock(rock: RockSubject, viewer: Viewer): boolean {
  if (viewer.isAdmin) return true;
  if (isMemberOf(viewer, rock.team_id)) return true;
  if (audienceTeamIdsOf(rock).some((id) => viewer.teamIds.has(id))) return true;
  return audienceUserIdsOf(rock).includes(viewer.uid);
}

/**
 * How much of the rock the viewer gets: the full rock, the headline plus
 * their own milestones (an assignee outside the full set), or nothing.
 * `milestoneOwnerIds` are the owners of the rock's milestones as loaded.
 */
export type RockView = "full" | "headline" | "none";

export function rockViewFor(
  rock: RockSubject,
  viewer: Viewer,
  milestoneOwnerIds: Iterable<string | null | undefined>,
): RockView {
  if (seesFullRock(rock, viewer)) return "full";
  for (const id of milestoneOwnerIds) if (isViewer(viewer, id)) return "headline";
  return "none";
}

function parentOrAdmin(rock: RockSubject, viewer: Viewer): boolean {
  return viewer.isAdmin || isMemberOf(viewer, rock.team_id);
}

function leaderOrAdmin(rock: RockSubject, viewer: Viewer): boolean {
  return viewer.isAdmin || isLeaderOf(viewer, rock.team_id);
}

export const rockAccess: AccessModule<RockSubject> & {
  /** Move the rock's status (setRockStatus). */
  canSetStatus(rock: RockSubject, viewer: Viewer): boolean;
  /** Change the audience (`audience_team_ids`, `audience_user_ids`). */
  canChangeAudience(rock: RockSubject, viewer: Viewer): boolean;
  /** Toggle Private (which clears the audience). */
  canSetPrivate(rock: RockSubject, viewer: Viewer): boolean;
  /** Set the Company flag. */
  canSetCompanyFlag(rock: RockSubject, viewer: Viewer): boolean;
} = {
  canSee: seesFullRock,
  // The audience changes the rock and its milestones as the parent team
  // does (spec §3.3 "Tasks on a rock").
  canEdit: seesFullRock,
  canSetStatus: seesFullRock,
  // One thread, open to everyone with the full rock
  // (requireRockThreadAccess in entity-comments/actions.ts).
  canComment: seesFullRock,
  // Spec §5.3: follow = canSee (owner + assigner locked, lib/follow.ts).
  canFollow: seesFullRock,
  // SPEC P9: mentions on rock comments, refused unless the person canSee.
  // Today rock comments carry no mentions.
  canMention: seesFullRock,
  // The audience may not delete the rock.
  canDelete: parentOrAdmin,
  canChangeAudience: leaderOrAdmin,
  canSetPrivate: leaderOrAdmin,
  canSetCompanyFlag: (_rock, viewer) => viewer.isAdmin,
};

/** The to-do thread / follow gate a milestone uses today (it is a to-do). */
function todoThreadGate(m: MilestoneSubject["milestone"], viewer: Viewer): boolean {
  if (!passesTeamGate(viewer, m.team_id)) return false;
  return m.visibility !== "private" || m.owner_id === viewer.uid;
}

function seesMilestone({ milestone, rock }: MilestoneSubject, viewer: Viewer): boolean {
  return seesFullRock(rock, viewer) || isViewer(viewer, milestone.owner_id);
}

function mutable(m: MilestoneSubject["milestone"], viewer: Viewer): boolean {
  return canMutateTodo(m, todoCallerFor(viewer, m.team_id));
}

export const milestoneAccess: CompletableAccessModule<MilestoneSubject> = {
  // Rock access, plus the milestone's own assignee (who sees only their
  // milestone, not the full rock). A block view grants nothing (§4).
  canSee: seesMilestone,
  // Add / retitle / reassign go through the rock modal: rock editors.
  canEdit: ({ rock }, viewer) => rockAccess.canEdit(rock, viewer),
  // toggleTodo (requireTickableTodo): the assignee, the parent team, the
  // audience and admins. A legacy "private" milestone keeps the to-do
  // owner/leader rule on top.
  canComplete: (subject, viewer) =>
    seesMilestone(subject, viewer) && mutable(subject.milestone, viewer),
  // A milestone's thread is its to-do thread (`entity_type: "todo"`),
  // team-scoped today. SPEC P6b: the milestone assignee and the audience can
  // comment too (spec §3.3 "Comment on a milestone and follow it").
  canComment: ({ milestone }, viewer) => todoThreadGate(milestone, viewer),
  // setTodoFollowing: same gate. SPEC P6b: assignee + audience can follow.
  canFollow: ({ milestone }, viewer) => todoThreadGate(milestone, viewer),
  // SPEC P9: mention = the comment set (assignee, parent, audience, admins);
  // a person who sees it only in a block cannot be mentioned (§4).
  canMention: (subject, person) => seesMilestone(subject, person),
  // Through the rock modal (rock editors). deleteTodo on the milestone's
  // team adds the to-do gate for the parent team's own lists.
  canDelete: ({ milestone, rock }, viewer) =>
    rockAccess.canEdit(rock, viewer) && mutable(milestone, viewer),
};
