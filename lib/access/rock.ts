// Shape C — rock and milestone (docs/PERMISSIONS_SPEC.md §3, §3.3).
//
// A thin wrapper over lib/rocks-share.ts, which stays the source of truth
// for today's rules (docs/ROCK_SHARING_RULES.md, commit 8193fa7). This file
// only translates the common `Viewer` into what those functions take and
// names the six questions; it re-implements nothing. The parity tests in
// rock.test.ts pin that.
//
// Current production behaviour, in one paragraph: the full rock goes to an
// admin, the parent team, a team in `shared_team_ids`, the rock's owner and
// the assignee of any milestone on it (`hasFullRockView`). Structural edits
// and delete stay with the parent team or an admin (`rockAccessFor` "edit").
// The owner, off the parent team but on a shared team, may also move the
// status ("status"). Any milestone may be ticked by full access, and by its
// own assignee or the rock's owner (`canTickMilestone`).

import { canMutateTodo } from "@/lib/todo-access";
import {
  canTickMilestone,
  hasFullRockView,
  rockAccessFor,
  type MilestoneLike,
  type RockAccess,
  type RockViewer,
  type ShareableRock,
} from "@/lib/rocks-share";
import { todoCallerFor } from "./team-item";
import {
  isMemberOf,
  passesTeamGate,
  type CompletableAccessModule,
  type AccessModule,
  type Viewer,
} from "./types";

export type RockSubject = ShareableRock & {
  /**
   * Denormalised owners of every milestone (RockDoc), what the rules and the
   * rock-thread gate read.
   */
  milestone_owner_ids?: readonly string[] | null;
  /**
   * Every milestone on the rock, when the caller has them loaded (pages do).
   * Wins over `milestone_owner_ids` for `canSee`, exactly as the pages pass
   * their loaded milestones to `hasFullRockView`.
   */
  milestones?: readonly MilestoneLike[] | null;
};

/** A milestone (a `todos` doc with `source_rock_id`) and the rock it hangs off. */
export type MilestoneSubject = {
  milestone: MilestoneLike & {
    /** The milestone's `team_id` — always the rock's parent team. */
    team_id: string;
    visibility?: unknown;
  };
  rock: RockSubject;
};

export function toRockViewer(viewer: Viewer): RockViewer {
  return { uid: viewer.uid, isAdmin: viewer.isAdmin, teamIds: viewer.teamIds };
}

function milestonesOf(rock: RockSubject): readonly MilestoneLike[] {
  if (rock.milestones) return rock.milestones;
  return (rock.milestone_owner_ids ?? []).map((owner_id) => ({ owner_id }));
}

/** `rockAccessFor` for a common Viewer: "edit" | "status" | "read". */
export function rockAccessLevel(rock: RockSubject, viewer: Viewer): RockAccess {
  return rockAccessFor(rock, toRockViewer(viewer));
}

function seesFullRock(rock: RockSubject, viewer: Viewer): boolean {
  // SPEC P6: the full rock goes to the parent team, the audience (teams AND
  // persons) and admins only. Milestone assignees and an off-team rock owner
  // lose the full rock (an assignee sees just their milestone plus the
  // rock's title/owner/team); `milestone_owner_ids` stops granting reads.
  return hasFullRockView(rock, toRockViewer(viewer), milestonesOf(rock));
}

function parentOrAdmin(rock: RockSubject, viewer: Viewer): boolean {
  return rockAccessLevel(rock, viewer) === "edit";
}

export const rockAccess: AccessModule<RockSubject> & {
  /** Move the rock's status (setRockStatus). */
  canSetStatus(rock: RockSubject, viewer: Viewer): boolean;
  /** Change who it is shared with (`shared_team_ids`). */
  canChangeAudience(rock: RockSubject, viewer: Viewer): boolean;
  /** Toggle "Keep on this team" (`team_only`; spec: Private). */
  canSetPrivate(rock: RockSubject, viewer: Viewer): boolean;
  /** Set the Company flag. */
  canSetCompanyFlag(rock: RockSubject, viewer: Viewer): boolean;
} = {
  canSee: seesFullRock,
  // SPEC P6: the audience (teams and persons) can change the rock and its
  // milestones too (spec §3.3 "Tasks on a rock"). Today: parent team + admin.
  canEdit: parentOrAdmin,
  // SPEC P6: status = parent team + audience + admins. Today the rock owner
  // may also move it from a shared team ("status"), and audience teams can't.
  canSetStatus: (rock, viewer) => rockAccessLevel(rock, viewer) !== "read",
  // Mirrors requireRockThreadAccess (entity-comments/actions.ts) and the
  // `rockFullAccess` rule: one thread, open to everyone with the full rock.
  // SPEC P6: narrows with canSee (assignees and off-team owner drop out).
  canComment: seesFullRock,
  // Spec §5.3: follow = canSee (owner + assigner locked, lib/follow.ts).
  canFollow: seesFullRock,
  // SPEC P9: mentions on rock comments, refused unless the person canSee.
  // Today rock comments carry no mentions.
  canMention: seesFullRock,
  // Matches spec: delete stays with the parent team and admins.
  canDelete: parentOrAdmin,
  // SPEC P6: only leaders of the parent team and admins change the audience
  // (spec §2.2, §3.3). Today any parent-team member can share.
  canChangeAudience: parentOrAdmin,
  // SPEC P6: only leaders of the parent team and admins set Private, which
  // replaces `team_only` and clears the audience. Today any member can.
  canSetPrivate: parentOrAdmin,
  canSetCompanyFlag: (_rock, viewer) => viewer.isAdmin,
};

/** The to-do thread / follow gate a milestone uses today (it is a to-do). */
function todoThreadGate(m: MilestoneSubject["milestone"], viewer: Viewer): boolean {
  if (!passesTeamGate(viewer, m.team_id)) return false;
  return m.visibility !== "private" || m.owner_id === viewer.uid;
}

function milestoneMutable(m: MilestoneSubject["milestone"], viewer: Viewer): boolean {
  return (
    passesTeamGate(viewer, m.team_id) &&
    canMutateTodo(m, todoCallerFor(viewer, m.team_id))
  );
}

export const milestoneAccess: CompletableAccessModule<MilestoneSubject> = {
  // SPEC P6: rock access, plus the milestone's own assignee (who sees only
  // their milestone, not the full rock). A block view grants nothing (§4).
  canSee: ({ rock }, viewer) => seesFullRock(rock, viewer),
  // Add / retitle / reassign / delete go through the rock modal on the
  // parent team. SPEC P6: the audience may too.
  canEdit: ({ rock }, viewer) => parentOrAdmin(rock, viewer),
  // toggleTodo: `canTickMilestone` (full access = admin or parent team) and
  // then `canMutateTodo` on the milestone's own team.
  // SPEC P6: assignee + parent team + audience + admins; the rock owner
  // loses "tick any milestone on my rock" unless they are on the parent team.
  canComplete: ({ milestone, rock }, viewer) =>
    canTickMilestone(rock, milestone, {
      uid: viewer.uid,
      fullAccess: viewer.isAdmin || isMemberOf(viewer, rock.team_id),
    }) && canMutateTodo(milestone, todoCallerFor(viewer, milestone.team_id)),
  // A milestone's thread is its to-do thread (`entity_type: "todo"`),
  // team-scoped today. SPEC P6: the milestone assignee and the audience can
  // comment too (spec §3.3 "Comment on a milestone and follow it").
  canComment: ({ milestone }, viewer) => todoThreadGate(milestone, viewer),
  // setTodoFollowing: same gate. SPEC P6: assignee + audience can follow.
  canFollow: ({ milestone }, viewer) => todoThreadGate(milestone, viewer),
  // SPEC P9: mention = the comment set (assignee, parent, audience, admins);
  // a person who sees it only in a block cannot be mentioned (§4).
  canMention: (subject, person) => seesFullRock(subject.rock, person),
  // deleteTodo on the milestone's team, or the rock modal (parent team).
  // SPEC P6: the audience may delete milestones.
  canDelete: ({ milestone }, viewer) => milestoneMutable(milestone, viewer),
};
