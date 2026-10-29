import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { deleteTeamCore, describeLeftBehind, teamDataSummary } from "./team-delete";

function seed() {
  const db = new FakeFirestore();
  db.seed("teams", "t1", { name: "Demo" });
  db.seed("teams", "t2", { name: "Other" });
  db.seed("users", "u1", { display_name: "Ann", team_ids: ["t1", "t2"] });
  db.seed("users", "u2", { display_name: "Bob", team_ids: ["t1"] });
  db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "leader" });
  db.seed("team_members", "t1__u2", { team_id: "t1", user_id: "u2", role: "member" });
  db.seed("team_members", "t2__u1", { team_id: "t2", user_id: "u1", role: "member" });
  db.seed("rocks", "r1", { team_id: "t1", title: "Rock" });
  db.seed("rocks", "r2", { team_id: "t2", title: "Elsewhere" });
  db.seed("todos", "m1", { team_id: "t1", title: "Milestone", source_rock_id: "r1" });
  db.seed("issues", "i1", { team_id: "t1", title: "Issue" });
  return db;
}

describe("teamDataSummary", () => {
  test("counts the roster and the rows that would be left behind", async () => {
    const s = await teamDataSummary(seed().asFirestore(), "t1");
    assert.ok(s);
    assert.equal(s.name, "Demo");
    assert.equal(s.memberCount, 2);
    const by = Object.fromEntries(s.data.map((d) => [d.collection, d.count]));
    assert.equal(by.rocks, 1);
    assert.equal(by.todos, 1);
    assert.equal(by.issues, 1);
    assert.equal(by.meetings, 0);
    assert.equal(describeLeftBehind(s.data), "1 rocks, 1 to-dos and milestones, 1 issues");
  });

  test("null for an unknown team", async () => {
    assert.equal(await teamDataSummary(seed().asFirestore(), "nope"), null);
  });
});

describe("deleteTeamCore", () => {
  test("removes the team and its roster, leaves data and other teams alone", async () => {
    const db = seed();
    const r = await deleteTeamCore(db.asFirestore(), "t1", "admin");
    assert.deepEqual(r, { name: "Demo", membersRemoved: 2 });
    assert.equal(db.raw("teams/t1"), undefined);
    assert.equal(db.raw("team_members/t1__u1"), undefined);
    assert.equal(db.raw("team_members/t1__u2"), undefined);
    // Untouched: the other team, its roster row, and the team's own data.
    assert.ok(db.raw("teams/t2"));
    assert.ok(db.raw("team_members/t2__u1"));
    assert.equal(db.raw("rocks/r1")?.team_id, "t1");
    assert.equal(db.raw("todos/m1")?.team_id, "t1");
  });

  test("recomputes each former member's team_ids cache", async () => {
    const db = seed();
    await deleteTeamCore(db.asFirestore(), "t1", "admin");
    assert.deepEqual(db.raw("users/u1")?.team_ids, ["t2"]);
    assert.deepEqual(db.raw("users/u2")?.team_ids, []);
  });

  test("logs the roster removals and the deletion for the audit trail", async () => {
    const db = seed();
    await deleteTeamCore(db.asFirestore(), "t1", "admin");
    const rows = db.docsIn("audit_log").map((d) => d.data);
    const roster = rows.filter((r) => r.change_kind === "roster");
    assert.equal(roster.length, 2);
    assert.ok(roster.every((r) => r.actor_uid === "admin" && r.team_id === "t1"));
    const deleted = rows.find((r) => r.change_kind === "team_deleted");
    assert.ok(deleted);
    assert.deepEqual(deleted.before, { name: "Demo", members: 2 });
  });

  test("refuses an unknown team", async () => {
    await assert.rejects(
      deleteTeamCore(seed().asFirestore(), "nope", "admin"),
      /no longer exists/,
    );
  });
});
