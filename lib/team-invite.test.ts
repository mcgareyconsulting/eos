import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { writeMembership } from "./team-invite";

const opts = {
  teamId: "t1",
  userId: "u1",
  role: "member" as const,
  firstName: "Bob",
  lastName: "Smith",
  email: "bob@example.com",
  actorUid: "leader-1",
};

describe("writeMembership", () => {
  test("creates the profile when the user doc does not exist", async () => {
    const db = new FakeFirestore();
    await writeMembership(db.asFirestore(), opts);
    const u = db.raw("users/u1");
    assert.equal(u?.display_name, "Bob Smith");
    assert.equal(u?.first_name, "Bob");
    assert.equal(u?.last_name, "Smith");
    assert.equal(u?.email, "bob@example.com");
    assert.equal(db.raw("team_members/t1__u1")?.role, "member");
  });

  test("does not overwrite an existing profile", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", {
      display_name: "Robert Smith",
      first_name: "Robert",
      last_name: "Smith",
      email: "rob@example.com",
    });
    await writeMembership(db.asFirestore(), opts);
    assert.equal(db.raw("users/u1")?.display_name, "Robert Smith");
    assert.equal(db.raw("users/u1")?.first_name, "Robert");
    assert.equal(db.raw("users/u1")?.email, "rob@example.com");
    assert.ok(db.raw("team_members/t1__u1"));
  });

  test("fills only blank profile fields", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", { display_name: "Robert Smith", first_name: "" });
    await writeMembership(db.asFirestore(), opts);
    assert.equal(db.raw("users/u1")?.display_name, "Robert Smith");
    assert.equal(db.raw("users/u1")?.first_name, "Bob");
    assert.equal(db.raw("users/u1")?.email, "bob@example.com");
  });

  test("rejects a duplicate membership", async () => {
    const db = new FakeFirestore();
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1" });
    await assert.rejects(
      () => writeMembership(db.asFirestore(), opts),
      /already on this team/,
    );
  });
});
