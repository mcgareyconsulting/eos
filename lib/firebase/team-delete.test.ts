import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  deleteTeamCore,
  describeLeftBehind,
  sortStranded,
  strandedRecordOf,
  teamDataSummary,
} from "./team-delete";

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
  db.seed("todos", "d1", { team_id: "t1", title: "Done to-do", completed_at: "x", archived_at: "y" });
  db.seed("issues", "i1", { team_id: "t1", title: "Issue" });
  db.seed("meetings", "mt1", { team_id: "t1", started_at: "2026-10-20T15:00:00Z", ended_at: "z" });
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
    assert.equal(by.todos, 2);
    assert.equal(by.issues, 1);
    assert.equal(by.meetings, 1);
    assert.equal(by.headlines, 0);
    assert.equal(
      describeLeftBehind(s.data),
      "1 rocks, 2 to-dos and milestones, 1 issues, 1 meetings",
    );
  });

  test("names each stranded record, open work first, closed work tagged", async () => {
    const s = await teamDataSummary(seed().asFirestore(), "t1");
    assert.ok(s);
    const todos = s.data.find((d) => d.collection === "todos")!;
    assert.deepEqual(todos.records, [
      { id: "m1", label: "Milestone", note: "milestone" },
      { id: "d1", label: "Done to-do", note: "done · archived" },
    ]);
    const meetings = s.data.find((d) => d.collection === "meetings")!;
    assert.deepEqual(meetings.records, [{ id: "mt1", label: "Meeting on 2026-10-20" }]);
    const rocks = s.data.find((d) => d.collection === "rocks")!;
    assert.deepEqual(rocks.records, [{ id: "r1", label: "Rock" }]);
  });

  test("null for an unknown team", async () => {
    assert.equal(await teamDataSummary(seed().asFirestore(), "nope"), null);
  });
});

describe("strandedRecordOf / sortStranded", () => {
  test("measurables read their name; nameless rows fall back to the id", () => {
    assert.deepEqual(strandedRecordOf("scorecard_metrics", "x", { name: "Calls" }), {
      id: "x",
      label: "Calls",
    });
    assert.deepEqual(strandedRecordOf("rocks", "r9", {}), { id: "r9", label: "r9" });
  });

  test("a done rock and an unended meeting are tagged", () => {
    assert.equal(strandedRecordOf("rocks", "r", { title: "R", status: "done" }).note, "done");
    assert.equal(
      strandedRecordOf("meetings", "m", { started_at: "2026-01-02T09:00:00Z" }).note,
      "not ended",
    );
  });

  test("open work sorts ahead of done or archived work, then A–Z", () => {
    const out = sortStranded([
      { id: "1", label: "Zed" },
      { id: "2", label: "Able", note: "archived" },
      { id: "3", label: "Mid" },
    ]);
    assert.deepEqual(out.map((r) => r.id), ["3", "1", "2"]);
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
