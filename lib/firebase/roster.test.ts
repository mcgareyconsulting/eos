import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { addExistingPersonToTeam, removePersonFromTeam } from "./roster";

function seed() {
  const db = new FakeFirestore();
  db.seed("teams", "t1", { name: "T1", speaking_order: ["u2"] });
  db.seed("users", "u1", { first_name: "Ann", last_name: "Lee", email: "a@x.com" });
  db.seed("users", "u2", { first_name: "Bob", last_name: "Ray", email: "b@x.com" });
  db.seed("users", "gone", { first_name: "Old", deactivated_at: "2026-01-01" });
  db.seed("team_members", "t1__u2", { team_id: "t1", user_id: "u2", role: "member" });
  db.seed("team_members", "t1__L", { team_id: "t1", user_id: "L", role: "leader" });
  return db;
}

describe("addExistingPersonToTeam", () => {
  test("adds an existing person as member", async () => {
    const db = seed();
    await addExistingPersonToTeam(db.asFirestore(), "t1", "u1", "actor");
    const m = db.raw("team_members/t1__u1");
    assert.equal(m?.role, "member");
    assert.equal(m?.team_id, "t1");
  });

  test("rejects unknown uid and creates no profile", async () => {
    const db = seed();
    await assert.rejects(
      addExistingPersonToTeam(db.asFirestore(), "t1", "nobody", "actor"),
      /not in the directory/,
    );
    assert.equal(db.raw("users/nobody"), undefined);
    assert.equal(db.raw("team_members/t1__nobody"), undefined);
  });

  test("rejects deactivated person", async () => {
    const db = seed();
    await assert.rejects(
      addExistingPersonToTeam(db.asFirestore(), "t1", "gone", "actor"),
      /deactivated/,
    );
    assert.equal(db.raw("team_members/t1__gone"), undefined);
  });

  test("rejects someone already on the team", async () => {
    const db = seed();
    await assert.rejects(
      addExistingPersonToTeam(db.asFirestore(), "t1", "u2", "actor"),
      /already on this team/,
    );
  });
});

describe("removePersonFromTeam", () => {
  const team = { id: "t1", speakingOrder: ["u2"] };

  test("removes a member and drops them from speaking order", async () => {
    const db = seed();
    await removePersonFromTeam(db.asFirestore(), team, "u2", false, "actor");
    assert.equal(db.raw("team_members/t1__u2"), undefined);
    assert.deepEqual(db.raw("teams/t1")?.speaking_order, []);
  });

  test("keeps the last leader", async () => {
    const db = seed();
    await assert.rejects(
      removePersonFromTeam(db.asFirestore(), team, "L", true, "actor"),
      /at least one leader/,
    );
    assert.ok(db.raw("team_members/t1__L"));
  });

  test("a non-admin leader cannot remove a leader", async () => {
    const db = seed();
    db.seed("team_members", "t1__L2", { team_id: "t1", user_id: "L2", role: "leader" });
    await assert.rejects(
      removePersonFromTeam(db.asFirestore(), team, "L", false, "actor"),
      /Only an admin can remove a leader/,
    );
    assert.ok(db.raw("team_members/t1__L"));
  });

  test("admin removes a leader when another remains", async () => {
    const db = seed();
    db.seed("team_members", "t1__L2", { team_id: "t1", user_id: "L2", role: "leader" });
    await removePersonFromTeam(db.asFirestore(), team, "L", true, "actor");
    assert.equal(db.raw("team_members/t1__L"), undefined);
  });

  test("rejects a person not on the team", async () => {
    const db = seed();
    await assert.rejects(
      removePersonFromTeam(db.asFirestore(), team, "u1", false, "actor"),
      /not on this team/,
    );
  });
});
