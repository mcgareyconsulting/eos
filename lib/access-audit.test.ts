import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  accessChangeRow,
  adminViewDocId,
  adminViewRow,
  dayKey,
  diffIds,
  recordAccessChange,
  recordAdminView,
  rockAccessEvents,
} from "./access-audit";
import { removePersonFromTeam, addExistingPersonToTeam } from "./firebase/roster";
import { reactivatePerson } from "./firebase/deactivate";

const NONE = { audience_team_ids: [], audience_user_ids: [], private: false };

describe("accessChangeRow", () => {
  test("shapes who, what, before and after", () => {
    const row = accessChangeRow({
      kind: "roster",
      actorUid: "admin-1",
      entityId: "t1__u1",
      teamId: "t1",
      targetUid: "u1",
      before: { on_roster: false },
      after: { on_roster: true, role: "member" },
    });
    assert.deepEqual(row, {
      entity_type: "access_change",
      action: "access_change",
      change_kind: "roster",
      entity_id: "t1__u1",
      actor_uid: "admin-1",
      actor_source: "app",
      team_id: "t1",
      target_uid: "u1",
      before: { on_roster: false },
      after: { on_roster: true, role: "member" },
    });
  });

  test("team and target default to null", () => {
    const row = accessChangeRow({
      kind: "admin_role",
      actorUid: "a",
      entityId: "u9",
      before: { admin: false },
      after: { admin: true },
    });
    assert.equal(row.team_id, null);
    assert.equal(row.target_uid, null);
  });
});

describe("diffIds", () => {
  test("added and removed", () => {
    assert.deepEqual(diffIds(["a", "b"], ["b", "c"]), { added: ["c"], removed: ["a"] });
  });
});

describe("rockAccessEvents", () => {
  test("no change, no events", () => {
    assert.deepEqual(
      rockAccessEvents("u", "r1", "t1", { ...NONE, audience_user_ids: ["a"] }, { ...NONE, audience_user_ids: ["a"] }),
      [],
    );
  });

  test("audience add and remove in one row with the id lists", () => {
    const events = rockAccessEvents(
      "lead",
      "r1",
      "t1",
      { audience_team_ids: ["x"], audience_user_ids: ["a"], private: false },
      { audience_team_ids: ["y"], audience_user_ids: ["a", "b"], private: false },
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "rock_audience");
    assert.equal(events[0].actorUid, "lead");
    assert.deepEqual(events[0].after?.added_team_ids, ["y"]);
    assert.deepEqual(events[0].after?.removed_team_ids, ["x"]);
    assert.deepEqual(events[0].after?.added_user_ids, ["b"]);
    assert.deepEqual(events[0].before?.audience_team_ids, ["x"]);
  });

  test("private on clears the audience: two rows, private flip first-class", () => {
    const events = rockAccessEvents(
      "lead",
      "r1",
      "t1",
      { audience_team_ids: [], audience_user_ids: ["a"], private: false },
      { ...NONE, private: true },
    );
    assert.deepEqual(
      events.map((e) => e.kind),
      ["rock_audience", "rock_private"],
    );
    assert.deepEqual(events[1].before, { private: false });
    assert.deepEqual(events[1].after, { private: true });
  });

  test("private off is recorded", () => {
    const events = rockAccessEvents("lead", "r1", "t1", { ...NONE, private: true }, NONE);
    assert.deepEqual(events.map((e) => e.kind), ["rock_private"]);
  });
});

describe("recordAccessChange", () => {
  test("appends an audit_log row with a server timestamp", async () => {
    const db = new FakeFirestore();
    await recordAccessChange(db.asFirestore(), {
      kind: "metric_public",
      actorUid: "u1",
      entityId: "m1",
      teamId: "t1",
      before: { is_public: false },
      after: { is_public: true },
    });
    const rows = db.docsIn("audit_log");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data.entity_type, "access_change");
    assert.equal(rows[0].data.change_kind, "metric_public");
    assert.ok(rows[0].data.timestamp);
  });

  test("a failing log write never throws into the caller", async () => {
    const broken = {
      collection: () => ({
        add: async () => {
          throw new Error("boom");
        },
      }),
    } as never;
    const orig = console.error;
    console.error = () => undefined;
    try {
      await recordAccessChange(broken, {
        kind: "roster",
        actorUid: "u",
        entityId: "e",
        before: null,
        after: null,
      });
    } finally {
      console.error = orig;
    }
  });
});

describe("admin-view log", () => {
  const day1 = new Date("2026-10-12T08:00:00Z");
  const sameDay = new Date("2026-10-12T23:59:00Z");
  const nextDay = new Date("2026-10-13T00:01:00Z");

  test("doc id is per admin, team and UTC day", () => {
    assert.equal(dayKey(day1), "2026-10-12");
    assert.equal(adminViewDocId("a1", "t1", day1), adminViewDocId("a1", "t1", sameDay));
    assert.notEqual(adminViewDocId("a1", "t1", day1), adminViewDocId("a1", "t1", nextDay));
    assert.notEqual(adminViewDocId("a1", "t1", day1), adminViewDocId("a2", "t1", day1));
    assert.notEqual(adminViewDocId("a1", "t1", day1), adminViewDocId("a1", "t2", day1));
  });

  test("row shape", () => {
    assert.deepEqual(adminViewRow("a1", "t1", day1), {
      entity_type: "admin_view",
      action: "admin_view",
      entity_id: "t1",
      actor_uid: "a1",
      actor_source: "app",
      team_id: "t1",
      day: "2026-10-12",
    });
  });

  test("one row per admin per team per day", async () => {
    const db = new FakeFirestore();
    const f = db.asFirestore();
    await recordAdminView(f, "a1", "t1", day1);
    await recordAdminView(f, "a1", "t1", sameDay);
    assert.equal(db.docsIn("audit_log").length, 1);
    await recordAdminView(f, "a1", "t2", sameDay);
    await recordAdminView(f, "a2", "t1", sameDay);
    await recordAdminView(f, "a1", "t1", nextDay);
    assert.equal(db.docsIn("audit_log").length, 4);
  });
});

describe("roster and deactivation write access_change rows", () => {
  test("add and remove a member: who, before and after", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", { display_name: "Jane Doe", email: "jane@example.com" });
    db.seed("teams", "t1", { name: "T", speaking_order: [] });
    await addExistingPersonToTeam(db.asFirestore(), "t1", "u1", "lead-1");
    await removePersonFromTeam(db.asFirestore(), { id: "t1", speakingOrder: [] }, "u1", false, "lead-1");
    const rows = db
      .docsIn("audit_log")
      .map((r) => r.data)
      .filter((r) => r.entity_type === "access_change");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].before, { on_roster: false });
    assert.deepEqual(rows[0].after, { on_roster: true, role: "member" });
    assert.equal(rows[0].actor_uid, "lead-1");
    assert.equal(rows[0].target_uid, "u1");
    assert.deepEqual(rows[1].before, { on_roster: true, role: "member" });
    assert.deepEqual(rows[1].after, { on_roster: false });
  });

  test("reactivation is recorded", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", { deactivated_at: 1, deactivated_by: "a" });
    const auth = {
      getUser: async () => {
        throw new Error("none");
      },
    } as never;
    const r = await reactivatePerson(db.asFirestore(), auth, "u1", "admin-1");
    assert.equal(r.ok, true);
    const [row] = db.docsIn("audit_log").map((x) => x.data);
    assert.equal(row.change_kind, "deactivation");
    assert.deepEqual(row.before, { deactivated: true });
    assert.deepEqual(row.after, { deactivated: false });
    assert.equal(db.raw("users/u1")?.updated_by, "admin-1");
  });
});
