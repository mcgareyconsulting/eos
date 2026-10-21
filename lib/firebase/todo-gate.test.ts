import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "../test-support/fake-firestore";
import { loadItem, loadViewers } from "./items";
import {
  ASSIGNEE_DEACTIVATED,
  ASSIGNEE_NOT_IN_DIRECTORY,
  requireAssignablePerson,
  todoCan,
  type TodoAction,
} from "./todo-gate";

const ACTIONS: TodoAction[] = ["see", "complete", "comment", "follow", "edit", "delete"];

/** Team T: lead, mem. Team O: asg (off-team assignee). `boss` is an admin on no team. */
function seed(): FakeFirestore {
  const f = new FakeFirestore();
  f.seed("team_members", "T__lead", { team_id: "T", user_id: "lead", role: "leader" });
  f.seed("team_members", "T__mem", { team_id: "T", user_id: "mem", role: "member" });
  f.seed("team_members", "O__asg", { team_id: "O", user_id: "asg", role: "member" });
  f.seed("team_members", "O__mate", { team_id: "O", user_id: "mate", role: "member" });
  f.seed("todos", "team", { team_id: "T", owner_id: "asg", created_by: "mem", visibility: "team" });
  f.seed("todos", "priv", { team_id: "T", owner_id: "asg", created_by: "mem", visibility: "private" });
  f.seed("rocks", "r1", { team_id: "T", owner_id: "mem", audience_team_ids: [] });
  f.seed("todos", "ms", { team_id: "T", owner_id: "asg", visibility: "team", source_rock_id: "r1" });
  return f;
}

async function matrix(f: FakeFirestore, todoId: string) {
  const db = f.asFirestore();
  const item = (await loadItem(db, { type: "todo", id: todoId }))!;
  const viewers = await loadViewers(db, ["lead", "mem", "asg", "mate", "boss"], {
    adminUids: async () => new Set(["boss"]),
  });
  const out: Record<string, string[]> = {};
  for (const [uid, v] of viewers) {
    out[uid] = ACTIONS.filter((a) => todoCan(item, v, a));
  }
  return out;
}

describe("todoCan — the to-do server gate", () => {
  test("team to-do assigned off-team: assignee sees, completes, comments, follows only", async () => {
    const m = await matrix(seed(), "team");
    assert.deepEqual(m.asg, ["see", "complete", "comment", "follow"]);
    assert.deepEqual(m.mem, ACTIONS);
    assert.deepEqual(m.lead, ACTIONS);
    assert.deepEqual(m.boss, ACTIONS);
    assert.deepEqual(m.mate, []);
  });

  test("private to-do: creator + assignee + admin; the leader and the team get nothing", async () => {
    const m = await matrix(seed(), "priv");
    assert.deepEqual(m.asg, ACTIONS);
    assert.deepEqual(m.mem, ACTIONS); // the creator
    assert.deepEqual(m.boss, ACTIONS);
    assert.deepEqual(m.lead, []);
    assert.deepEqual(m.mate, []);
  });

  test("milestone: the rock rule (assignee ticks, comments, follows; never edits)", async () => {
    const m = await matrix(seed(), "ms");
    assert.deepEqual(m.asg, ["see", "complete", "comment", "follow"]);
    assert.deepEqual(m.mem, ACTIONS);
    assert.deepEqual(m.mate, []);
  });
});

describe("requireAssignablePerson — org-wide assignment", () => {
  function people(): FakeFirestore {
    const f = seed();
    f.seed("users", "asg", { first_name: "Asa" });
    f.seed("users", "gone", { first_name: "Old", deactivated_at: "2026-09-01" });
    f.seed("team_members", "O__gone", { team_id: "O", user_id: "gone", role: "member" });
    return f;
  }

  test("accepts an active person on any team", async () => {
    await requireAssignablePerson(people().asFirestore(), "asg");
  });

  test("accepts a rostered person with no profile yet", async () => {
    await requireAssignablePerson(people().asFirestore(), "mate");
  });

  test("rejects a deactivated person, even with a stale roster row", async () => {
    await assert.rejects(
      requireAssignablePerson(people().asFirestore(), "gone"),
      new RegExp(ASSIGNEE_DEACTIVATED.slice(0, 20)),
    );
  });

  test("rejects an unknown uid", async () => {
    await assert.rejects(
      requireAssignablePerson(people().asFirestore(), "nobody"),
      new RegExp(ASSIGNEE_NOT_IN_DIRECTORY.slice(0, 20)),
    );
    await assert.rejects(requireAssignablePerson(people().asFirestore(), ""));
  });

  test("self and the current owner pass without a lookup", async () => {
    const db = people().asFirestore();
    await requireAssignablePerson(db, "nobody", { self: "nobody" });
    await requireAssignablePerson(db, "gone", { keep: "gone" });
  });
});
