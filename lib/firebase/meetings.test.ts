import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { deleteMeetingAsLeader } from "./meetings";

// requireFirebaseUser()'s shape, trimmed to what teams.ts reads.
function fakeUser(opts: { uid: string; isAdmin: boolean; db: FakeFirestore }) {
  return async () => ({
    uid: opts.uid,
    email: null,
    name: null,
    picture: null,
    isAdmin: opts.isAdmin,
    db: opts.db.asFirestore(),
  });
}

async function assertNotFound(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.match((err as { digest?: string }).digest ?? "", /^NEXT_HTTP_ERROR_FALLBACK;404/);
    return true;
  });
}

// Team t1 with a leader (lead) and a member (mem); meeting m1 on t1 with two
// ratings; meeting m2 on another team.
function seeded() {
  const db = new FakeFirestore();
  db.seed("teams", "t1", { name: "Leadership" });
  db.seed("teams", "t2", { name: "Ops" });
  db.seed("team_members", "t1__lead", { team_id: "t1", user_id: "lead", role: "leader" });
  db.seed("team_members", "t1__mem", { team_id: "t1", user_id: "mem", role: "member" });
  db.seed("meetings", "m1", { team_id: "t1", started_at: "2026-10-05" });
  db.seed("meetings/m1/effectiveness_scores", "lead", { score: 9 });
  db.seed("meetings/m1/effectiveness_scores", "mem", { score: 8 });
  db.seed("meetings", "m2", { team_id: "t2" });
  return db;
}

describe("deleteMeetingAsLeader", () => {
  test("a plain member cannot delete a meeting (C-02)", async () => {
    const db = seeded();
    await assertNotFound(() =>
      deleteMeetingAsLeader("t1", "m1", { user: fakeUser({ uid: "mem", isAdmin: false, db }) }),
    );
    assert.ok(db.raw("meetings/m1"), "meeting survives");
    assert.equal(db.docsIn("meetings/m1/effectiveness_scores").length, 2);
  });

  test("a non-member cannot delete a meeting", async () => {
    const db = seeded();
    await assertNotFound(() =>
      deleteMeetingAsLeader("t1", "m1", { user: fakeUser({ uid: "stranger", isAdmin: false, db }) }),
    );
    assert.ok(db.raw("meetings/m1"));
  });

  test("the team leader deletes the meeting and its ratings", async () => {
    const db = seeded();
    await deleteMeetingAsLeader("t1", "m1", { user: fakeUser({ uid: "lead", isAdmin: false, db }) });
    assert.equal(db.raw("meetings/m1"), undefined);
    assert.equal(db.docsIn("meetings/m1/effectiveness_scores").length, 0);
  });

  test("an org admin may delete without a roster row", async () => {
    const db = seeded();
    await deleteMeetingAsLeader("t1", "m1", { user: fakeUser({ uid: "boss", isAdmin: true, db }) });
    assert.equal(db.raw("meetings/m1"), undefined);
  });

  test("a leader cannot delete another team's meeting through their own team", async () => {
    const db = seeded();
    await assertNotFound(() =>
      deleteMeetingAsLeader("t1", "m2", { user: fakeUser({ uid: "lead", isAdmin: false, db }) }),
    );
    assert.ok(db.raw("meetings/m2"));
  });
});
