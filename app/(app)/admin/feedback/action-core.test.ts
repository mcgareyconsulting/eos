import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { feedbackEditFormFrom } from "@/lib/feedback/edit";
import { readFeedbackItem } from "@/lib/feedback/model";
import {
  createFeedbackCore,
  saveFeedbackEditsCore,
  setFeedbackStatusCore,
  type FeedbackActionDeps,
} from "./action-core";

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

// 2026-10-20 04:30 UTC: still Oct 19 on the bank's clock.
const NOW = () => new Date("2026-10-20T04:30:00Z");
const admin = (db: FakeFirestore): FeedbackActionDeps => ({
  user: fakeUser({ uid: "admin-1", isAdmin: true, db }),
  now: NOW,
});
const member = (db: FakeFirestore): FeedbackActionDeps => ({
  user: fakeUser({ uid: "mem-1", isAdmin: false, db }),
  now: NOW,
});

function seed(db: FakeFirestore, number: number, data: Record<string, unknown> = {}) {
  const id = `fb-${String(number).padStart(3, "0")}`;
  db.seed("feedback_items", id, {
    number,
    sheet_row: number + 1,
    reported_on: "2026-07-30",
    reviewer: "Jenna Scheeler",
    page: "Scorecard",
    type: "bug",
    original_comment: `comment ${number}`,
    status: "building",
    shipped_at: null,
    evidence: [],
    prs: [],
    ...data,
  });
  return id;
}

const item = (db: FakeFirestore, id: string) => db.raw(`feedback_items/${id}`)!;
const activity = (db: FakeFirestore, id: string) =>
  db.docsIn(`feedback_items/${id}/activity`).map((d) => d.data);

async function assertNotFound(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.match((err as { digest?: string }).digest ?? "", /^NEXT_HTTP_ERROR_FALLBACK;404/);
    return true;
  });
}

function formFor(db: FakeFirestore, id: string) {
  return feedbackEditFormFrom(readFeedbackItem(id, item(db, id)));
}

describe("non-admins are refused before any write", () => {
  test("save, status and create all 404 and write nothing", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 1);
    const before = JSON.stringify(item(db, id));
    await assertNotFound(() =>
      saveFeedbackEditsCore(id, { ...formFor(db, id), status: "completed" }, null, member(db)),
    );
    await assertNotFound(() => setFeedbackStatusCore(id, "completed", member(db)));
    // Invalid input and malformed ids too: the gate comes before anything else.
    await assertNotFound(() => setFeedbackStatusCore(id, "closed", member(db)));
    await assertNotFound(() => setFeedbackStatusCore("../users/x", "completed", member(db)));
    await assertNotFound(() => saveFeedbackEditsCore(42, null, "bogus", member(db)));
    await assertNotFound(() => saveFeedbackEditsCore("fb-404", {}, null, member(db)));
    await assertNotFound(() =>
      createFeedbackCore(
        { reported_on: "2026-10-19", reviewer: "S", page: "Rocks", type: "bug", original_comment: "x" },
        member(db),
      ),
    );
    await assertNotFound(() => createFeedbackCore({}, member(db)));
    assert.equal(JSON.stringify(item(db, id)), before);
    assert.deepEqual(activity(db, id), []);
    assert.equal(db.docsIn("feedback_items").length, 1);
  });
});

describe("saveFeedbackEditsCore", () => {
  test("a status change writes the item and a status activity row", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 2, { status: "follow_up" });
    const res = await saveFeedbackEditsCore(
      id,
      { ...formFor(db, id), status: "answered", client_resolution: "Answered in the L10.", prs: "40" },
      null,
      admin(db),
    );
    assert.deepEqual(res, { ok: true, changed: ["status", "client_resolution", "prs"] });
    assert.equal(item(db, id).status, "answered");
    assert.deepEqual(item(db, id).prs, [40]);
    assert.equal(item(db, id).updated_by, "admin-1");
    assert.equal(item(db, id).shipped_at, null, "answered is not a shipped status");
    const rows = activity(db, id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "status");
    assert.equal(rows[0].from, "follow_up");
    assert.equal(rows[0].to, "answered");
    assert.equal(rows[0].actor_uid, "admin-1");
    assert.deepEqual(rows[0].fields, ["client_resolution", "prs"]);
  });

  test("moving to Completed with no shipped date fills today (Denver)", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 3);
    const res = await saveFeedbackEditsCore(id, { ...formFor(db, id), status: "completed" }, null, admin(db));
    assert.deepEqual(res, { ok: true, changed: ["status", "shipped_at"] });
    assert.equal(item(db, id).shipped_at, "2026-10-19");
    assert.deepEqual(activity(db, id)[0].fields, ["shipped_at"]);
  });

  test("a typed shipped date wins, and it stays editable", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 4);
    await saveFeedbackEditsCore(id, { ...formFor(db, id), status: "deployed", shipped_at: "2026-10-01" }, null, admin(db));
    assert.equal(item(db, id).shipped_at, "2026-10-01");
    const res = await saveFeedbackEditsCore(id, { shipped_at: "2026-10-02" }, null, admin(db));
    assert.deepEqual(res, { ok: true, changed: ["shipped_at"] });
    assert.equal(item(db, id).shipped_at, "2026-10-02");
  });

  test("bad values come back as refusals, nothing written", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 5);
    for (const [patch, re] of [
      [{ status: "closed" }, /Unknown status/],
      [{ prs: "40, abc" }, /not a PR number/],
      [{ shipped_at: "yesterday" }, /Shipped date/],
    ] as const) {
      const res = await saveFeedbackEditsCore(id, { ...formFor(db, id), ...patch }, null, admin(db));
      assert.equal(res.ok, false);
      assert.match(res.ok ? "" : res.error, re);
    }
    const res = await saveFeedbackEditsCore(id, null, null, admin(db));
    assert.equal(res.ok, false);
    assert.deepEqual(activity(db, id), []);
  });

  test("the original comment cannot be smuggled in", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 6);
    const res = await saveFeedbackEditsCore(
      id,
      { ...formFor(db, id), original_comment: "rewritten", thread: "x", number: 99 },
      null,
      admin(db),
    );
    assert.deepEqual(res, { ok: true, changed: [] });
    assert.equal(item(db, id).original_comment, "comment 6");
    assert.equal(item(db, id).number, 6);
  });

  test("a missing or malformed id is a refusal", async () => {
    const db = new FakeFirestore();
    for (const id of ["fb-404", "../fb-001", 7]) {
      const res = await saveFeedbackEditsCore(id, {}, null, admin(db));
      assert.deepEqual(res, { ok: false, error: "Feedback item not found." });
    }
  });
});

describe("concurrent edits", () => {
  const OPENED = "2026-10-01T12:00:00.000Z";

  test("a status changed on the board after the dialog opened is not reverted; the stale save is refused", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 20, { status: "building", updated_at: OPENED });
    const form = formFor(db, id); // admin A opens the dialog
    await setFeedbackStatusCore(id, "follow_up", admin(db)); // admin B, on the board
    const res = await saveFeedbackEditsCore(id, { ...form, resolution: "A's note" }, OPENED, admin(db));
    assert.deepEqual(res, {
      ok: false,
      error: "This item changed since you opened it. Reload to see the latest.",
    });
    assert.equal(item(db, id).status, "follow_up");
    assert.equal(item(db, id).resolution ?? null, null);
    assert.equal(activity(db, id).length, 1, "only B's change is logged");
  });

  test("after a reload, sending only the changed field leaves the other admin's status alone", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 21, { status: "building", updated_at: OPENED });
    await setFeedbackStatusCore(id, "follow_up", admin(db));
    const reloaded = readFeedbackItem(id, item(db, id)).updated_at;
    const res = await saveFeedbackEditsCore(id, { resolution: "A's note" }, reloaded, admin(db));
    assert.deepEqual(res, { ok: true, changed: ["resolution"] });
    assert.equal(item(db, id).status, "follow_up");
    assert.equal(activity(db, id).at(-1)?.kind, "edited");
  });

  test("an updated_at that is not a string or null is refused", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 22, { updated_at: OPENED });
    const res = await saveFeedbackEditsCore(id, { resolution: "x" }, 12345, admin(db));
    assert.equal(res.ok, false);
    assert.deepEqual(activity(db, id), []);
  });

  test("a save with no changed fields writes no activity", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 23, { updated_at: OPENED, updated_by: "earlier" });
    assert.deepEqual(await saveFeedbackEditsCore(id, {}, OPENED, admin(db)), { ok: true, changed: [] });
    assert.deepEqual(await saveFeedbackEditsCore(id, formFor(db, id), OPENED, admin(db)), { ok: true, changed: [] });
    assert.deepEqual(activity(db, id), []);
    assert.equal(item(db, id).updated_by, "earlier");
  });
});

describe("shipped_at fill (inside the update transaction)", () => {
  test("status → Completed with empty shipped_at fills today on the Denver clock", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 30, { status: "building", shipped_at: null });
    const res = await saveFeedbackEditsCore(id, { status: "completed" }, null, admin(db));
    assert.deepEqual(res, { ok: true, changed: ["status", "shipped_at"] });
    // NOW is 2026-10-20 04:30 UTC = Oct 19 in Denver.
    assert.equal(item(db, id).shipped_at, "2026-10-19");
  });

  test("an already-set shipped_at is untouched", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 31, { status: "building", shipped_at: "2026-09-02" });
    const res = await saveFeedbackEditsCore(id, { status: "completed" }, null, admin(db));
    assert.deepEqual(res, { ok: true, changed: ["status"] });
    assert.equal(item(db, id).shipped_at, "2026-09-02");
  });
});

describe("setFeedbackStatusCore (board)", () => {
  test("changes only the status and logs it; fills shipped_at on Deployed", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 8, { status: "new", client_resolution: "keep" });
    const res = await setFeedbackStatusCore(id, "deployed", admin(db));
    assert.deepEqual(res, { ok: true, changed: ["status", "shipped_at"] });
    assert.equal(item(db, id).status, "deployed");
    assert.equal(item(db, id).shipped_at, "2026-10-19");
    assert.equal(item(db, id).client_resolution, "keep");
    assert.equal(activity(db, id)[0].kind, "status");
  });

  test("an unknown status is refused", async () => {
    const db = new FakeFirestore();
    const id = seed(db, 9);
    const res = await setFeedbackStatusCore(id, "closed", admin(db));
    assert.equal(res.ok, false);
    assert.equal(item(db, id).status, "building");
  });
});

describe("createFeedbackCore", () => {
  test("logs a new item after the highest number", async () => {
    const db = new FakeFirestore();
    seed(db, 59);
    const res = await createFeedbackCore(
      {
        reported_on: "2026-10-19",
        reviewer: "Steph Benes",
        page: "Rocks",
        type: "ux",
        summary: "Slow",
        original_comment: "Rock page is slow",
        status: "completed",
      },
      admin(db),
    );
    assert.deepEqual(res, { ok: true, id: "fb-060", number: 60 });
    const doc = item(db, "fb-060");
    assert.equal(doc.status, "new", "status from the client is ignored");
    assert.equal(doc.created_by, "admin-1");
    assert.equal(doc.thread, null);
    assert.equal(activity(db, "fb-060")[0].kind, "created");
  });

  test("invalid input is a refusal, nothing written", async () => {
    const db = new FakeFirestore();
    const res = await createFeedbackCore(
      { reported_on: "2026-13-01", reviewer: "S", page: "Rocks", type: "bug", original_comment: "x" },
      admin(db),
    );
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error, /Reported date/);
    const res2 = await createFeedbackCore({ reported_on: "2026-10-01", reviewer: "S", page: "Rocks", type: "bug" }, admin(db));
    assert.match(res2.ok ? "" : res2.error, /Comment is required/);
    assert.equal(db.docsIn("feedback_items").length, 0);
  });
});
