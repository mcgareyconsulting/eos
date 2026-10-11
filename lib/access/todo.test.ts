// Shapes A (team to-do) and B (private to-do), and the `todoAccess`
// dispatcher, against lib/todo-access.ts and the to-do server actions.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canMutateTodo } from "@/lib/todo-access";
import { teamTodoAccess, todoCallerFor } from "./team-item";
import { privateTodoAccess } from "./private-item";
import { todoAccess, type TodoSubject } from "./index";
import { actionTeams, PARENT, VIEWER_ENTRIES, VIEWERS } from "./test-viewers";
import type { Viewer } from "./types";

const TODOS: Record<string, TodoSubject> = {
  team: { team_id: PARENT, visibility: "team", owner_id: VIEWERS.parentMember.uid },
  legacyNoVisibility: { team_id: PARENT, owner_id: VIEWERS.parentMember.uid },
  teamOffTeamOwner: { team_id: PARENT, visibility: "team", owner_id: VIEWERS.assignee.uid },
  privateMine: {
    team_id: PARENT,
    visibility: "private",
    owner_id: VIEWERS.parentMember.uid,
    created_by: VIEWERS.parentMember.uid,
  },
  privateAssignedByLeader: {
    team_id: PARENT,
    visibility: "private",
    owner_id: VIEWERS.parentMember.uid,
    created_by: VIEWERS.parentLeader.uid,
  },
  privateOwnerless: { team_id: PARENT, visibility: "private", owner_id: null },
};

/** What todos/actions.ts does for a mutation from team `teamId`. */
function actionMutates(todo: TodoSubject, v: Viewer, teamId: string): boolean {
  if (todo.team_id !== teamId) return false; // requireTeamDoc
  if (!v.isAdmin && !v.teamIds.has(teamId)) return false; // requireTeamAccess
  return canMutateTodo(todo, {
    uid: v.uid,
    isAdmin: v.isAdmin,
    membershipRole: v.leaderOf.has(teamId)
      ? "leader"
      : v.teamIds.has(teamId)
        ? "member"
        : null,
  });
}

/** addEntityComment / setTodoFollowing for a to-do, from team `teamId`. */
function actionThread(todo: TodoSubject, v: Viewer, teamId: string): boolean {
  if (todo.team_id !== teamId) return false;
  if (!v.isAdmin && !v.teamIds.has(teamId)) return false;
  return todo.visibility !== "private" || todo.owner_id === v.uid;
}

/** The To-Dos page / Home filter (owner-only for private), on a team the viewer can open. */
function pageShows(todo: TodoSubject, v: Viewer, teamId: string): boolean {
  if (todo.team_id !== teamId) return false;
  if (!v.isAdmin && !v.teamIds.has(teamId)) return false;
  return todo.visibility !== "private" || todo.owner_id === v.uid;
}

describe("todoAccess — parity with lib/todo-access.ts and the to-do actions", () => {
  for (const [todoName, todo] of Object.entries(TODOS)) {
    for (const [viewerName, v] of VIEWER_ENTRIES) {
      test(`${todoName} × ${viewerName}`, () => {
        const teams = actionTeams(v);
        const mut = teams.some((t) => actionMutates(todo, v, t));
        assert.equal(todoAccess.canEdit(todo, v), mut, "canEdit");
        assert.equal(todoAccess.canDelete(todo, v), mut, "canDelete");
        assert.equal(todoAccess.canComplete(todo, v), mut, "canComplete");
        const thread = teams.some((t) => actionThread(todo, v, t));
        assert.equal(todoAccess.canComment(todo, v), thread, "canComment");
        assert.equal(todoAccess.canFollow(todo, v), thread, "canFollow");
        assert.equal(
          todoAccess.canSee(todo, v),
          teams.some((t) => pageShows(todo, v, t)),
          "canSee",
        );
        assert.equal(todoAccess.canMention(todo, v), todoAccess.canSee(todo, v));
        // The caller the wrapper builds is the one the action builds.
        if (v.teamIds.has(todo.team_id) || v.isAdmin) {
          assert.equal(
            canMutateTodo(todo, todoCallerFor(v, todo.team_id)),
            actionMutates(todo, v, todo.team_id),
          );
        }
      });
    }
  }
});

describe("todoAccess dispatch", () => {
  test("private → shape B, anything else → shape A", () => {
    const v = VIEWERS.parentLeader;
    // A leader can see a team to-do but not someone else's private one.
    assert.equal(todoAccess.canSee(TODOS.team, v), teamTodoAccess.canSee(TODOS.team, v));
    assert.equal(
      todoAccess.canSee(TODOS.privateMine, v),
      privateTodoAccess.canSee(TODOS.privateMine, v),
    );
    assert.equal(todoAccess.canSee(TODOS.privateMine, v), false);
  });
});

describe("team to-do (shape A) — current behaviour", () => {
  test("parent team and admins only; the off-team assignee is shut out (SPEC P8)", () => {
    const t = TODOS.teamOffTeamOwner;
    assert.equal(teamTodoAccess.canSee(t, VIEWERS.parentMember), true);
    assert.equal(teamTodoAccess.canSee(t, VIEWERS.admin), true);
    assert.equal(teamTodoAccess.canSee(t, VIEWERS.assignee), false);
    assert.equal(teamTodoAccess.canComplete(t, VIEWERS.assignee), false);
    assert.equal(teamTodoAccess.canComment(t, VIEWERS.assignee), false);
    assert.equal(teamTodoAccess.canSee(t, VIEWERS.outsider), false);
  });
});

describe("private to-do (shape B) — current behaviour", () => {
  const t = TODOS.privateAssignedByLeader;

  test("the owner sees, edits, comments, follows", () => {
    const v = VIEWERS.parentMember;
    assert.equal(privateTodoAccess.canSee(t, v), true);
    assert.equal(privateTodoAccess.canEdit(t, v), true);
    assert.equal(privateTodoAccess.canComment(t, v), true);
    assert.equal(privateTodoAccess.canFollow(t, v), true);
  });

  test("a leader of the team may change it without seeing it (SPEC P8)", () => {
    const v = VIEWERS.parentLeader;
    assert.equal(privateTodoAccess.canEdit(t, v), true);
    assert.equal(privateTodoAccess.canChangeVisibility(t, v), true);
    assert.equal(privateTodoAccess.canSee(t, v), false);
    assert.equal(privateTodoAccess.canComment(t, v), false);
  });

  test("the creator who is not the owner has no access (SPEC P8)", () => {
    // privateAssignedByLeader was created by the leader; strip the role.
    const creator: Viewer = { ...VIEWERS.parentLeader, leaderOf: new Set() };
    assert.equal(privateTodoAccess.canSee(t, creator), false);
    assert.equal(privateTodoAccess.canEdit(t, creator), false);
  });

  test("an admin may change it but no page shows it to them (SPEC P8)", () => {
    const v = VIEWERS.admin;
    assert.equal(privateTodoAccess.canEdit(t, v), true);
    assert.equal(privateTodoAccess.canDelete(t, v), true);
    assert.equal(privateTodoAccess.canSee(t, v), false);
    assert.equal(privateTodoAccess.canComment(t, v), false);
  });

  test("a leader of another team leads nothing here", () => {
    assert.equal(privateTodoAccess.canEdit(t, VIEWERS.otherLeader), false);
  });

  test("an ownerless private to-do: leader and admin only", () => {
    const o = TODOS.privateOwnerless;
    assert.equal(privateTodoAccess.canEdit(o, VIEWERS.parentMember), false);
    assert.equal(privateTodoAccess.canEdit(o, VIEWERS.parentLeader), true);
    assert.equal(privateTodoAccess.canSee(o, VIEWERS.parentMember), false);
  });
});
