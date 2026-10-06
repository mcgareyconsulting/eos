import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { deleteStamp, stamp, stampBeforeDelete } from "./audit-stamp";
import { Writer } from "./team-import/owners";
import { writeMembership } from "./team-invite";
import { writeActivity } from "./firebase/activity";

const SERVER_TS = FieldValue.serverTimestamp();

/** Record every write/remove the fake sees, in order. */
function recording(db: FakeFirestore) {
  const log: { op: "write" | "remove"; path: string; data?: Record<string, unknown> }[] = [];
  const write = db.write.bind(db);
  const remove = db.remove.bind(db);
  db.write = (path, data) => {
    log.push({ op: "write", path, data });
    write(path, data);
  };
  db.remove = (path) => {
    log.push({ op: "remove", path });
    remove(path);
  };
  return log;
}

function ref(db: FakeFirestore, collection: string, id: string) {
  return db.collection(collection).doc(id) as unknown as DocumentReference;
}

describe("stamp / deleteStamp", () => {
  test("stamp carries the actor and a server timestamp", () => {
    const s = stamp("u1");
    assert.equal(s.updated_by, "u1");
    assert.ok(s.updated_at.isEqual(SERVER_TS));
    assert.deepEqual(Object.keys(s).sort(), ["updated_at", "updated_by"]);
  });

  test("deleteStamp carries the actor and a server timestamp", () => {
    const s = deleteStamp("u1");
    assert.equal(s.deleted_by, "u1");
    assert.ok(s.deleted_at.isEqual(SERVER_TS));
  });
});

describe("stampBeforeDelete", () => {
  test("writes deleted_by onto every doc, leaving the rest of it alone", async () => {
    const db = new FakeFirestore();
    db.seed("todos", "a", { title: "A" });
    db.seed("todos", "b", { title: "B" });
    await stampBeforeDelete([ref(db, "todos", "a"), ref(db, "todos", "b")], "u1");
    for (const id of ["a", "b"]) {
      const doc = db.raw(`todos/${id}`)!;
      assert.equal(doc.deleted_by, "u1");
      // The stamp write is itself an audited update — attributed too.
      assert.equal(doc.updated_by, "u1");
      assert.ok((doc.deleted_at as FieldValue).isEqual(SERVER_TS));
      assert.ok(doc.title);
    }
  });

  test("accepts a single ref", async () => {
    const db = new FakeFirestore();
    db.seed("headlines", "h", { title: "H" });
    await stampBeforeDelete(ref(db, "headlines", "h"), "u2");
    assert.equal(db.raw("headlines/h")?.deleted_by, "u2");
  });

  test("a doc that is already gone is skipped, not an error, and not recreated", async () => {
    const db = new FakeFirestore();
    db.seed("todos", "a", { title: "A" });
    await stampBeforeDelete([ref(db, "todos", "gone"), ref(db, "todos", "a")], "u1");
    assert.equal(db.raw("todos/gone"), undefined);
    assert.equal(db.raw("todos/a")?.deleted_by, "u1");
  });

  test("any other failure propagates, so the caller's delete never runs (fail closed)", async () => {
    const failing = {
      update: async () => {
        throw Object.assign(new Error("unavailable"), { code: 14 });
      },
    } as unknown as DocumentReference;
    await assert.rejects(() => stampBeforeDelete([failing], "u1"), /unavailable/);
  });

  test("an empty list is a no-op", async () => {
    await stampBeforeDelete([], "u1");
  });
});

describe("lib helpers server actions call stamp their writes", () => {
  test("import Writer stamps every row when an in-app actor is given", async () => {
    const db = new FakeFirestore();
    const w = new Writer(db.asFirestore(), false, "admin-1");
    await w.set(["rocks", "r1"], { title: "R" });
    await w.flush();
    assert.equal(db.raw("rocks/r1")?.updated_by, "admin-1");
    assert.equal(db.raw("rocks/r1")?.title, "R");
  });

  test("import Writer leaves CLI rows (no actor) unstamped", async () => {
    const db = new FakeFirestore();
    const w = new Writer(db.asFirestore(), false);
    await w.set(["rocks", "r1"], { title: "R" });
    await w.flush();
    assert.equal(db.raw("rocks/r1")?.updated_by, undefined);
  });

  test("writeMembership stamps the profile and the roster row with the inviter", async () => {
    const db = new FakeFirestore();
    await writeMembership(db.asFirestore(), {
      teamId: "t1",
      userId: "new",
      role: "member",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      actorUid: "lead",
    });
    assert.equal(db.raw("users/new")?.updated_by, "lead");
    assert.equal(db.raw("team_members/t1__new")?.updated_by, "lead");
  });

  test("writeActivity stamps the trace row with its actor", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", { display_name: "Jane" });
    await writeActivity({
      db: db.asFirestore(),
      teamId: "t1",
      entity: { type: "todo", id: "td1", visibility: "team", ownerId: "u1" },
      kind: "completed",
      actor: { id: "u1" },
    });
    const [row] = db.docsIn("entity_activity");
    assert.equal(row.data.updated_by, "u1");
    assert.equal(row.data.actor_id, "u1");
  });

  test("stamp-then-delete leaves the actor in the doc's last state before removal", async () => {
    const db = new FakeFirestore();
    db.seed("todos", "a", { title: "A" });
    const log = recording(db);
    const r = ref(db, "todos", "a");
    await stampBeforeDelete(r, "u1");
    await r.delete();
    assert.deepEqual(
      log.map((e) => e.op),
      ["write", "remove"],
    );
    assert.equal(log[0].data?.deleted_by, "u1");
  });
});
