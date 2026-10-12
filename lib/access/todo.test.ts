// Shapes A (team to-do) and B (private to-do), and the `todoAccess`
// dispatcher (docs/PERMISSIONS_SPEC.md §3, §3.1, §3.2; P8a).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { teamTodoAccess } from "./team-item";
import { privateTodoAccess } from "./private-item";
import { todoAccess, type TodoSubject } from "./index";
import { PARENT, VIEWER_ENTRIES, VIEWERS } from "./test-viewers";
import type { Viewer } from "./types";

type Name = keyof typeof VIEWERS;

const TODOS = {
  team: { team_id: PARENT, visibility: "team", owner_id: VIEWERS.parentMember.uid },
  legacyNoVisibility: { team_id: PARENT, owner_id: VIEWERS.parentMember.uid },
  /** Assigned to someone on another team (spec §3.1). */
  teamOffTeamOwner: {
    team_id: PARENT,
    visibility: "team",
    owner_id: VIEWERS.assignee.uid,
    created_by: VIEWERS.parentMember.uid,
  },
  privateMine: {
    team_id: PARENT,
    visibility: "private",
    owner_id: VIEWERS.parentMember.uid,
    created_by: VIEWERS.parentMember.uid,
  },
  /** Private, created by the leader, assigned to a member. */
  privateAssignedByLeader: {
    team_id: PARENT,
    visibility: "private",
    owner_id: VIEWERS.parentMember.uid,
    created_by: VIEWERS.parentLeader.uid,
  },
  /** Private, created on the parent team, assigned off-team. */
  privateOffTeam: {
    team_id: PARENT,
    visibility: "private",
    owner_id: VIEWERS.assignee.uid,
    created_by: VIEWERS.parentMember.uid,
  },
  privateOwnerless: { team_id: PARENT, visibility: "private", owner_id: null },
} satisfies Record<string, TodoSubject>;

const TEAM_OR_ADMIN: Name[] = ["admin", "parentLeader", "parentMember"];

function expectAll(
  todo: TodoSubject,
  want: {
    see: Name[];
    edit: Name[];
    complete: Name[];
  },
) {
  for (const [name, v] of VIEWER_ENTRIES) {
    const see = want.see.includes(name);
    const edit = want.edit.includes(name);
    const complete = want.complete.includes(name);
    assert.equal(todoAccess.canSee(todo, v), see, `${name} see`);
    assert.equal(todoAccess.canComment(todo, v), see, `${name} comment = see`);
    assert.equal(todoAccess.canFollow(todo, v), see, `${name} follow = see`);
    assert.equal(todoAccess.canMention(todo, v), see, `${name} mention = see`);
    assert.equal(todoAccess.canEdit(todo, v), edit, `${name} edit`);
    assert.equal(todoAccess.canDelete(todo, v), edit, `${name} delete = edit`);
    assert.equal(todoAccess.canComplete(todo, v), complete, `${name} complete`);
  }
}

describe("team to-do (shape A)", () => {
  test("own-team owner: the team and admins do everything", () => {
    for (const t of [TODOS.team, TODOS.legacyNoVisibility]) {
      expectAll(t, { see: TEAM_OR_ADMIN, edit: TEAM_OR_ADMIN, complete: TEAM_OR_ADMIN });
    }
  });

  test("off-team assignee: sees, completes, comments, follows; cannot edit or delete", () => {
    expectAll(TODOS.teamOffTeamOwner, {
      see: [...TEAM_OR_ADMIN, "assignee"],
      edit: TEAM_OR_ADMIN,
      complete: [...TEAM_OR_ADMIN, "assignee"],
    });
  });

  test("teams the assignee is on gain nothing", () => {
    const teammate: Viewer = { ...VIEWERS.outsider, uid: "u-o-mate", teamIds: new Set(["team-o"]) };
    assert.equal(teamTodoAccess.canSee(TODOS.teamOffTeamOwner, teammate), false);
  });
});

describe("private to-do (shape B)", () => {
  test("own private: the owner (also creator) and admins only — not the leader", () => {
    expectAll(TODOS.privateMine, {
      see: ["admin", "parentMember"],
      edit: ["admin", "parentMember"],
      complete: ["admin", "parentMember"],
    });
  });

  test("created by the leader: the leader keeps access as creator, not as leader", () => {
    expectAll(TODOS.privateAssignedByLeader, {
      see: ["admin", "parentLeader", "parentMember"],
      edit: ["admin", "parentLeader", "parentMember"],
      complete: ["admin", "parentLeader", "parentMember"],
    });
    // Strip the creator link: the same leader now has nothing.
    const noCreator = { ...TODOS.privateAssignedByLeader, created_by: "someone" };
    assert.equal(privateTodoAccess.canSee(noCreator, VIEWERS.parentLeader), false);
    assert.equal(privateTodoAccess.canEdit(noCreator, VIEWERS.parentLeader), false);
  });

  test("off-team assignee and the creator, with no team gate; the team sees nothing", () => {
    expectAll(TODOS.privateOffTeam, {
      see: ["admin", "parentMember", "assignee"],
      edit: ["admin", "parentMember", "assignee"],
      complete: ["admin", "parentMember", "assignee"],
    });
  });

  test("ownerless with no creator: admins only", () => {
    expectAll(TODOS.privateOwnerless, { see: ["admin"], edit: ["admin"], complete: ["admin"] });
  });

  test("only the creator or the assignee can publish it to the team", () => {
    const t = TODOS.privateOffTeam;
    assert.equal(privateTodoAccess.canChangeVisibility(t, VIEWERS.parentMember), true);
    assert.equal(privateTodoAccess.canChangeVisibility(t, VIEWERS.assignee), true);
    assert.equal(privateTodoAccess.canChangeVisibility(t, VIEWERS.admin), false);
    assert.equal(privateTodoAccess.canChangeVisibility(t, VIEWERS.parentLeader), false);
  });
});

describe("todoAccess dispatch", () => {
  test("private → shape B, anything else → shape A", () => {
    const v = VIEWERS.parentLeader;
    assert.equal(todoAccess.canSee(TODOS.team, v), teamTodoAccess.canSee(TODOS.team, v));
    assert.equal(
      todoAccess.canSee(TODOS.privateMine, v),
      privateTodoAccess.canSee(TODOS.privateMine, v),
    );
    assert.equal(todoAccess.canSee(TODOS.privateMine, v), false);
  });
});
