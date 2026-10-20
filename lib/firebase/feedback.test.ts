import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  FEEDBACK_NOT_FOUND,
  FEEDBACK_STALE,
  createFeedbackItem,
  getFeedbackItem,
  listFeedbackActivity,
  listFeedbackItems,
  updateFeedbackItem,
} from "./feedback";

// The tracker's gate (lib/firebase/feedback-access.ts) reads the session's
// email and app_config/feedback_tracker. "listed" is on the list; "member"
// is not; "orgAdmin" holds the admin role but is NOT listed — and gets in.
function fakeUser(opts: { uid: string; email: string | null; isAdmin: boolean; db: FakeFirestore }) {
  return async () => ({
    uid: opts.uid,
    email: opts.email,
    name: null,
    picture: null,
    isAdmin: opts.isAdmin,
    emailVerified: true,
    db: opts.db.asFirestore(),
  });
}

function grant(db: FakeFirestore) {
  db.seed("app_config", "feedback_tracker", { emails: ["listed@example.com"] });
}

const admin = (db: FakeFirestore) => {
  grant(db);
  return { user: fakeUser({ uid: "admin-1", email: "Listed@Example.com", isAdmin: false, db }) };
};
const member = (db: FakeFirestore) => {
  grant(db);
  return { user: fakeUser({ uid: "mem-1", email: "mem@example.com", isAdmin: false, db }) };
};
const orgAdmin = (db: FakeFirestore) => {
  grant(db);
  return { user: fakeUser({ uid: "root", email: "root@example.com", isAdmin: true, db }) };
};

async function assertNotFound(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.match((err as { digest?: string }).digest ?? "", /^NEXT_HTTP_ERROR_FALLBACK;404/);
    return true;
  });
}

const NEW = {
  reported_on: "2026-10-19",
  reviewer: "Steph Benes",
  page: "Rocks",
  type: "bug",
  original_comment: "Rock page is slow",
};

function seedItem(db: FakeFirestore, number: number, data: Record<string, unknown> = {}) {
  db.seed("feedback_items", `fb-${String(number).padStart(3, "0")}`, {
    number,
    sheet_row: number + 1,
    reported_on: "2026-07-30",
    reviewer: "Jenna Scheeler",
    page: "Scorecard",
    type: "bug",
    original_comment: `comment ${number}`,
    status: "follow_up",
    evidence: [],
    prs: [],
    ...data,
  });
}

function activity(db: FakeFirestore, id: string) {
  return db.docsIn(`feedback_items/${id}/activity`).map((d) => d.data);
}

describe("access-list gate", () => {
  test("every function 404s an unlisted non-admin and writes nothing", async () => {
    for (const who of [member]) {
      const db = new FakeFirestore();
      seedItem(db, 1);
      await assertNotFound(() => listFeedbackItems(who(db)));
      await assertNotFound(() => getFeedbackItem("fb-001", who(db)));
      await assertNotFound(() => listFeedbackActivity("fb-001", who(db)));
      await assertNotFound(() => createFeedbackItem(NEW, who(db)));
      await assertNotFound(() => updateFeedbackItem("fb-001", { status: "completed" }, who(db)));
      assert.equal(db.docsIn("feedback_items").length, 1);
      assert.equal(db.raw("feedback_items/fb-001")?.status, "follow_up");
      assert.equal(activity(db, "fb-001").length, 0);
    }
  });

  test("an org admin who is not on the list gets in", async () => {
    const db = new FakeFirestore();
    seedItem(db, 1);
    assert.equal((await listFeedbackItems(orgAdmin(db))).length, 1);
  });

  test("no access doc (or an empty list) denies every non-admin, fail closed", async () => {
    const db = new FakeFirestore();
    seedItem(db, 1);
    const listed = { user: fakeUser({ uid: "admin-1", email: "listed@example.com", isAdmin: false, db }) };
    await assertNotFound(() => listFeedbackItems(listed));
    db.seed("app_config", "feedback_tracker", { emails: [] });
    await assertNotFound(() => listFeedbackItems({ user: listed.user }));
  });

  test("a listed user who is not an org admin gets in", async () => {
    const db = new FakeFirestore();
    seedItem(db, 1);
    assert.equal((await listFeedbackItems(admin(db))).length, 1);
  });
});

describe("reads", () => {
  test("list is ordered by number (numerically)", async () => {
    const db = new FakeFirestore();
    for (const n of [10, 2, 1, 59]) seedItem(db, n);
    const items = await listFeedbackItems(admin(db));
    assert.deepEqual(
      items.map((i) => i.number),
      [1, 2, 10, 59],
    );
    assert.equal(items[0].id, "fb-001");
  });

  test("get by id; unknown or malformed id is null", async () => {
    const db = new FakeFirestore();
    seedItem(db, 7, { client_resolution: "Fixed." });
    const item = await getFeedbackItem("fb-007", admin(db));
    assert.equal(item?.client_resolution, "Fixed.");
    assert.equal(await getFeedbackItem("fb-008", admin(db)), null);
    assert.equal(await getFeedbackItem("../users/x", admin(db)), null);
  });
});

describe("createFeedbackItem", () => {
  test("first item is fb-001; next number is max + 1 (gaps are not refilled)", async () => {
    const db = new FakeFirestore();
    assert.deepEqual(await createFeedbackItem(NEW, admin(db)), { id: "fb-001", number: 1 });

    const db2 = new FakeFirestore();
    seedItem(db2, 1);
    seedItem(db2, 59);
    seedItem(db2, 9);
    assert.deepEqual(await createFeedbackItem(NEW, admin(db2)), { id: "fb-060", number: 60 });
    assert.deepEqual(await createFeedbackItem(NEW, admin(db2)), { id: "fb-061", number: 61 });
  });

  test("concurrent creates take distinct numbers", async () => {
    const db = new FakeFirestore();
    seedItem(db, 59);
    const made = await Promise.all([createFeedbackItem(NEW, admin(db)), createFeedbackItem(NEW, admin(db))]);
    assert.deepEqual(made.map((m) => m.number).sort(), [60, 61]);
  });

  test("status new, C-07 stamp, created activity row", async () => {
    const db = new FakeFirestore();
    const { id } = await createFeedbackItem(NEW, admin(db));
    const doc = db.raw(`feedback_items/${id}`)!;
    assert.equal(doc.status, "new");
    assert.equal(doc.created_by, "admin-1");
    assert.equal(doc.updated_by, "admin-1");
    assert.ok(doc.updated_at, "stamped");
    assert.equal(doc.original_comment, "Rock page is slow");
    assert.equal(doc.sheet_row, null);
    const rows = activity(db, id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "created");
    assert.equal(rows[0].actor_uid, "admin-1");
    assert.equal(rows[0].to, "new");
    assert.ok(rows[0].at);
  });

  test("invalid input writes nothing", async () => {
    const db = new FakeFirestore();
    await assert.rejects(() => createFeedbackItem({ ...NEW, type: "closed" }, admin(db)), /Unknown type/);
    assert.equal(db.docsIn("feedback_items").length, 0);
  });
});

describe("updateFeedbackItem", () => {
  test("status change is logged with from/to and stamped", async () => {
    const db = new FakeFirestore();
    seedItem(db, 3);
    const res = await updateFeedbackItem("fb-003", { status: "completed", prs: [40] }, admin(db));
    assert.deepEqual(res.changed, ["status", "prs"]);
    const doc = db.raw("feedback_items/fb-003")!;
    assert.equal(doc.status, "completed");
    assert.deepEqual(doc.prs, [40]);
    assert.equal(doc.updated_by, "admin-1");
    const rows = activity(db, "fb-003");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "status");
    assert.equal(rows[0].from, "follow_up");
    assert.equal(rows[0].to, "completed");
    assert.deepEqual(rows[0].fields, ["prs"]);
    assert.equal(rows[0].actor_uid, "admin-1");
  });

  test("other edits log an edited row listing the fields", async () => {
    const db = new FakeFirestore();
    seedItem(db, 4);
    await updateFeedbackItem("fb-004", { client_resolution: " Done. ", follow_ups: ["Ask Steph"] }, admin(db));
    assert.equal(db.raw("feedback_items/fb-004")?.client_resolution, "Done.");
    const rows = activity(db, "fb-004");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "edited");
    assert.deepEqual(rows[0].fields, ["client_resolution", "follow_ups"]);
    assert.equal(rows[0].from, undefined);
  });

  test("expectedUpdatedAt: a stale save is refused and writes nothing", async () => {
    const db = new FakeFirestore();
    const opened = "2026-10-01T12:00:00.000Z";
    seedItem(db, 11, { updated_at: opened, status: "building" });
    // Another admin changes the status after the form opened.
    await updateFeedbackItem("fb-011", { status: "deployed" }, admin(db));
    const before = JSON.stringify(db.raw("feedback_items/fb-011"));
    await assert.rejects(
      () => updateFeedbackItem("fb-011", { status: "building", resolution: "x" }, admin(db), { expectedUpdatedAt: opened }),
      { message: FEEDBACK_STALE },
    );
    assert.equal(JSON.stringify(db.raw("feedback_items/fb-011")), before);
    assert.equal(db.raw("feedback_items/fb-011")?.status, "deployed");
    assert.equal(activity(db, "fb-011").length, 1);
  });

  test("expectedUpdatedAt: a matching value saves", async () => {
    const db = new FakeFirestore();
    seedItem(db, 12, { updated_at: "2026-10-01T12:00:00.000Z" });
    const res = await updateFeedbackItem("fb-012", { resolution: "y" }, admin(db), {
      expectedUpdatedAt: "2026-10-01T12:00:00.000Z",
    });
    assert.deepEqual(res.changed, ["resolution"]);
  });

  test("prepare sees the in-transaction snapshot and its result is validated", async () => {
    const db = new FakeFirestore();
    seedItem(db, 13, { status: "building", shipped_at: "2026-09-01" });
    const seen: unknown[] = [];
    const res = await updateFeedbackItem("fb-013", { status: "completed" }, admin(db), {
      prepare: (current, patch) => {
        seen.push(current.shipped_at);
        return { ...patch, follow_ups: ["from prepare"] };
      },
    });
    assert.deepEqual(seen, ["2026-09-01"]);
    assert.deepEqual(res.changed, ["status", "follow_ups"]);
    await assert.rejects(
      () =>
        updateFeedbackItem("fb-013", { status: "new" }, admin(db), {
          prepare: (_c, p) => ({ ...p, shipped_at: "not a date" }),
        }),
      /Shipped date/,
    );
    assert.equal(db.raw("feedback_items/fb-013")?.status, "completed");
  });

  test("a save that changes nothing writes and logs nothing", async () => {
    const db = new FakeFirestore();
    seedItem(db, 5, { updated_by: "earlier" });
    const res = await updateFeedbackItem("fb-005", { status: "follow_up", prs: [] }, admin(db));
    assert.deepEqual(res.changed, []);
    assert.equal(db.raw("feedback_items/fb-005")?.updated_by, "earlier");
    assert.equal(activity(db, "fb-005").length, 0);
  });

  test("the original comment cannot be edited; invalid status refused", async () => {
    const db = new FakeFirestore();
    seedItem(db, 6);
    await assert.rejects(() => updateFeedbackItem("fb-006", { original_comment: "x" }, admin(db)), /cannot be edited/);
    await assert.rejects(() => updateFeedbackItem("fb-006", { status: "closed" }, admin(db)), /Unknown status/);
    assert.equal(db.raw("feedback_items/fb-006")?.original_comment, "comment 6");
    assert.equal(activity(db, "fb-006").length, 0);
  });

  test("missing item", async () => {
    const db = new FakeFirestore();
    await assert.rejects(() => updateFeedbackItem("fb-099", { status: "new" }, admin(db)), {
      message: FEEDBACK_NOT_FOUND,
    });
    await assert.rejects(() => updateFeedbackItem("nope", { status: "new" }, admin(db)), {
      message: FEEDBACK_NOT_FOUND,
    });
  });

  test("listFeedbackActivity returns the trace", async () => {
    const db = new FakeFirestore();
    seedItem(db, 8);
    await updateFeedbackItem("fb-008", { status: "building" }, admin(db));
    const trace = await listFeedbackActivity("fb-008", admin(db));
    assert.equal(trace.length, 1);
    assert.equal(trace[0].kind, "status");
    assert.equal(trace[0].from, "follow_up");
    assert.equal(trace[0].to, "building");
  });
});
