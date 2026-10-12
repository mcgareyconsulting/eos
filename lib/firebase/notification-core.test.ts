import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "../test-support/fake-firestore";
import { emitEvent, notify, writeNotifications } from "./notifications";
import { autoFollow, setFollowingAs } from "./follow";
import { labelNotifications, peekItem } from "./item-peek";
import { loadItem, loadViewers } from "./items";
import { purgeItem } from "./purge";

const noAdmins = { adminUids: async () => new Set<string>() };

/** Team T: lead + mem. Team X: outsider. `boss` is an org admin on no team. */
function seed(): FakeFirestore {
  const f = new FakeFirestore();
  f.seed("teams", "T", { name: "ESD" });
  f.seed("team_members", "T__lead", { team_id: "T", user_id: "lead", role: "leader" });
  f.seed("team_members", "T__mem", { team_id: "T", user_id: "mem", role: "member" });
  f.seed("team_members", "T__own", { team_id: "T", user_id: "own", role: "member" });
  f.seed("team_members", "X__out", { team_id: "X", user_id: "out", role: "member" });
  f.seed("users", "lead", { display_name: "Lee Lead" });
  f.seed("todos", "t1", {
    team_id: "T",
    title: "Ship it",
    description: "the thing",
    owner_id: "own",
    assigned_by: "lead",
    visibility: "team",
    follower_ids: ["mem", "out"],
  });
  f.seed("todos", "p1", {
    team_id: "T",
    title: "Secret",
    owner_id: "own",
    created_by: "lead",
    visibility: "private",
    follower_ids: ["mem"],
  });
  return f;
}

function rows(f: FakeFirestore) {
  return f.docsIn("notifications").map((d) => d.data);
}

describe("loadViewers", () => {
  test("roster teams, leader teams and the admin claim", async () => {
    const f = seed();
    const v = await loadViewers(f.asFirestore(), ["lead", "out", "boss"], {
      adminUids: async () => new Set(["boss"]),
    });
    assert.deepEqual([...v.get("lead")!.teamIds], ["T"]);
    assert.deepEqual([...v.get("lead")!.leaderOf], ["T"]);
    assert.deepEqual([...v.get("out")!.leaderOf], []);
    assert.equal(v.get("boss")!.isAdmin, true);
    assert.equal(v.get("boss")!.teamIds.size, 0);
  });
});

describe("emitEvent", () => {
  test("followers ∪ locked owner + assigner, minus actor, minus no-access", async () => {
    const f = seed();
    const n = await emitEvent(f.asFirestore(), { type: "todo", id: "t1" }, "completed", "mem", {
      teamId: "T",
      viewerDeps: noAdmins,
    });
    // `out` follows but is off the team: dropped at send time.
    assert.equal(n, 2);
    assert.deepEqual(rows(f).map((r) => r.user_id).sort(), ["lead", "own"]);
  });

  test("rows are pointers only", async () => {
    const f = seed();
    await emitEvent(f.asFirestore(), { type: "todo", id: "t1" }, "comment", "lead", {
      teamId: "T",
      direct: { mention: ["mem"] },
      viewerDeps: noAdmins,
    });
    const byUser = Object.fromEntries(rows(f).map((r) => [r.user_id, r]));
    assert.equal(byUser.mem.kind, "mention");
    assert.equal(byUser.own.kind, "comment");
    assert.deepEqual(Object.keys(byUser.own).sort(), [
      "actor_id",
      "archived_at",
      "created_at",
      "entity_id",
      "entity_type",
      "event",
      "kind",
      "read_at",
      "team_id",
      "user_id",
    ]);
    assert.equal(byUser.own.event, "comment");
    assert.equal(byUser.own.entity_type, "todo");
    assert.equal(byUser.own.team_id, "T");
  });

  test("private to-do: only those who can see it are told", async () => {
    const f = seed();
    await emitEvent(f.asFirestore(), { type: "todo", id: "p1" }, "completed", "lead", {
      teamId: "T",
      direct: { mention: ["mem"] },
      viewerDeps: noAdmins,
    });
    assert.deepEqual(rows(f).map((r) => r.user_id), ["own"]);
  });

  test("an unassigned notice reaches a person who lost access", async () => {
    const f = seed();
    await emitEvent(f.asFirestore(), { type: "todo", id: "p1" }, null, "lead", {
      teamId: "T",
      direct: { unassigned: ["mem"] },
      viewerDeps: noAdmins,
    });
    assert.deepEqual(rows(f).map((r) => [r.user_id, r.kind]), [["mem", "unassigned"]]);
  });

  test("a missing item writes nothing", async () => {
    const f = seed();
    assert.equal(
      await emitEvent(f.asFirestore(), { type: "todo", id: "nope" }, "comment", "x", {
        teamId: "T",
        viewerDeps: noAdmins,
      }),
      0,
    );
    // The legacy notify() shape never even loads viewers for a missing item.
    await notify({
      db: f.asFirestore(),
      recipientIds: ["mem"],
      kind: "assigned",
      team: { id: "T", name: "ignored" },
      entity: { type: "todo", id: "nope", title: "ignored" },
      actor: { id: "lead" },
    });
    assert.equal(rows(f).length, 0);
  });

  test("writeNotifications de-dupes and writes nothing for nobody", async () => {
    const f = seed();
    const n = await writeNotifications({
      db: f.asFirestore(),
      ref: { type: "issue", id: "i1" },
      teamId: "T",
      actorId: "a",
      event: null,
      deliveries: [
        { uid: "b", kind: "assigned" },
        { uid: "b", kind: "mention" },
        { uid: "", kind: "mention" },
      ],
    });
    assert.equal(n, 1);
    assert.equal(
      await writeNotifications({
        db: f.asFirestore(),
        ref: { type: "issue", id: "i1" },
        teamId: "T",
        actorId: "a",
        event: null,
        deliveries: [],
      }),
      0,
    );
  });
});

describe("follow writes", () => {
  test("canFollow gates; locked followers cannot unfollow", async () => {
    const f = seed();
    const db = f.asFirestore();
    const v = await loadViewers(db, ["mem", "own", "out", "lead"], noAdmins);
    assert.deepEqual(await setFollowingAs(db, { type: "todo", id: "t1" }, v.get("out")!, true), {
      ok: false,
      reason: "not_found",
    });
    const own = await setFollowingAs(db, { type: "todo", id: "t1" }, v.get("own")!, false);
    assert.deepEqual(own, { ok: false, reason: "locked" });
    const lead = await setFollowingAs(db, { type: "todo", id: "t1" }, v.get("lead")!, false);
    assert.deepEqual(lead, { ok: false, reason: "locked" });
    const mem = await setFollowingAs(db, { type: "todo", id: "t1" }, v.get("mem")!, false);
    assert.equal(mem.ok, true);
    assert.deepEqual(f.raw("todos/t1")!.follower_ids, ["out"]);
    // Private to-do: a member who cannot see it gets not_found.
    const p = await setFollowingAs(db, { type: "todo", id: "p1" }, v.get("mem")!, true);
    assert.deepEqual(p, { ok: false, reason: "not_found" });
  });

  test("auto-follow skips people who may not follow (a mention grants nothing)", async () => {
    const f = seed();
    f.seed("todos", "t2", { team_id: "T", title: "x", owner_id: "own", follower_ids: [] });
    const added = await autoFollow(f.asFirestore(), { type: "todo", id: "t2" }, ["mem", "out"], noAdmins);
    assert.deepEqual(added, ["mem"]);
    assert.deepEqual(f.raw("todos/t2")!.follower_ids, ["mem"]);
  });
});

describe("read-time peek", () => {
  test("title + snippet through canSee; sentinel otherwise", async () => {
    const f = seed();
    const db = f.asFirestore();
    const v = await loadViewers(db, ["mem", "out"], noAdmins);
    const ok = await peekItem(db, { type: "todo", id: "t1" }, v.get("mem")!);
    assert.deepEqual(ok, {
      access: "ok",
      ref: { type: "todo", id: "t1" },
      teamId: "T",
      teamName: "ESD",
      title: "Ship it",
      snippet: "the thing",
      href: "/teams/T/todos?todo=t1",
    });
    assert.deepEqual(await peekItem(db, { type: "todo", id: "t1" }, v.get("out")!), {
      access: "none",
    });
    assert.deepEqual(await peekItem(db, { type: "todo", id: "p1" }, v.get("mem")!), {
      access: "none",
    });
    assert.deepEqual(await peekItem(db, { type: "todo", id: "gone" }, v.get("mem")!), {
      access: "none",
    });
  });

  test("legacy rows render through the peek, never their stored copies", async () => {
    const f = seed();
    f.seed("notifications", "n1", {
      user_id: "mem",
      team_id: "T",
      team_name: "Old name",
      entity_type: "todo",
      entity_id: "p1",
      entity_title: "Secret",
      kind: "comment",
      actor_id: "lead",
      actor_name: "stale",
      detail: "leaked text",
    });
    f.seed("notifications", "n2", { user_id: "other", entity_type: "todo", entity_id: "t1" });
    const v = await loadViewers(f.asFirestore(), ["mem"], noAdmins);
    const labels = await labelNotifications(f.asFirestore(), v.get("mem")!, ["n1", "n2"]);
    assert.deepEqual(Object.keys(labels), ["n1"]);
    assert.deepEqual(labels.n1, { actorName: "Lee Lead", peek: { access: "none" } });
  });

  test("a todos doc with a rock is reclassified as a milestone", async () => {
    const f = seed();
    f.seed("rocks", "r1", { team_id: "T", owner_id: "own", title: "Rock" });
    f.seed("todos", "m1", { team_id: "T", title: "M", owner_id: "out", source_rock_id: "r1" });
    const item = await loadItem(f.asFirestore(), { type: "todo", id: "m1" });
    assert.equal(item?.ref.type, "milestone");
  });
});

describe("purgeItem", () => {
  test("deletes the item's comments, notifications and activity only", async () => {
    const f = seed();
    f.seed("entity_comments", "c1", { entity_type: "todo", entity_id: "t1" });
    f.seed("entity_comments", "c2", { entity_type: "issue", entity_id: "t1" });
    f.seed("entity_comments", "c3", { entity_type: "todo", entity_id: "t9" });
    f.seed("notifications", "n1", { entity_type: "todo", entity_id: "t1", user_id: "a" });
    f.seed("notifications", "n2", { entity_type: "milestone", entity_id: "t1", user_id: "b" });
    f.seed("notifications", "n3", { entity_type: "todo", entity_id: "t9", user_id: "a" });
    f.seed("entity_activity", "a1", { entity_type: "todo", entity_id: "t1" });
    const out = await purgeItem(f.asFirestore(), { type: "todo", id: "t1" });
    assert.deepEqual(out, { comments: 1, notifications: 2, activity: 1 });
    assert.deepEqual(f.docsIn("entity_comments").map((d) => d.id).sort(), ["c2", "c3"]);
    assert.deepEqual(f.docsIn("notifications").map((d) => d.id), ["n3"]);
    assert.equal(f.docsIn("entity_activity").length, 0);
  });

  test("a type without a thread leaves comments alone", async () => {
    const f = seed();
    f.seed("entity_comments", "c1", { entity_type: "todo", entity_id: "m1" });
    f.seed("notifications", "n1", { entity_type: "metric", entity_id: "m1", user_id: "a" });
    const out = await purgeItem(f.asFirestore(), { type: "metric", id: "m1" });
    assert.deepEqual(out, { comments: 0, notifications: 1, activity: 0 });
  });
});
