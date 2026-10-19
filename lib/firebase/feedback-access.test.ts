import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  canUseFeedbackTracker,
  readFeedbackAccessList,
  requireFeedbackTrackerAccess,
  setFeedbackAccess,
} from "./feedback-access";

function user(db: Firestore, email: string | null, emailVerified?: boolean | null) {
  return { user: async () => ({ uid: "u", email, emailVerified, db }) };
}

function listed(emails: unknown) {
  const db = new FakeFirestore();
  db.seed("app_config", "feedback_tracker", { emails, updated_by: "op" });
  return db.asFirestore();
}

async function denied(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.match((err as { digest?: string }).digest ?? "", /^NEXT_HTTP_ERROR_FALLBACK;404/);
    return true;
  });
}

describe("requireFeedbackTrackerAccess", () => {
  test("a listed email gets in, case-insensitively", async () => {
    const db = listed(["steph@example.com"]);
    assert.equal((await requireFeedbackTrackerAccess(user(db, "Steph@Example.COM", true))).uid, "u");
    assert.equal(await canUseFeedbackTracker(user(db, "steph@example.com")), true);
  });

  test("not listed, no email claim, unverified email → 404", async () => {
    const db = listed(["steph@example.com"]);
    await denied(() => requireFeedbackTrackerAccess(user(db, "joe@example.com", true)));
    await denied(() => requireFeedbackTrackerAccess(user(db, null, true)));
    await denied(() => requireFeedbackTrackerAccess(user(db, "steph@example.com", false)));
    assert.equal(await canUseFeedbackTracker(user(db, "steph@example.com", false)), false);
  });

  test("no doc, an empty list, or a malformed list → 404 for everyone", async () => {
    await denied(() => requireFeedbackTrackerAccess(user(new FakeFirestore().asFirestore(), "steph@example.com", true)));
    await denied(() => requireFeedbackTrackerAccess(user(listed([]), "steph@example.com", true)));
    await denied(() => requireFeedbackTrackerAccess(user(listed("steph@example.com"), "steph@example.com", true)));
  });

  test("a failed read fails closed", async () => {
    const broken = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error("UNAVAILABLE");
          },
        }),
      }),
    } as unknown as Firestore;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      assert.equal(await canUseFeedbackTracker(user(broken, "steph@example.com", true)), false);
      await denied(() => requireFeedbackTrackerAccess(user(broken, "steph@example.com", true)));
    } finally {
      console.error = orig;
    }
    assert.ok(errors.length > 0, "the failure is logged");
  });
});

describe("setFeedbackAccess (the Directory's Feedback tracker switch)", () => {
  test("grants and removes by email, case-insensitively, stamped; no-op reports false", async () => {
    const db = new FakeFirestore();
    db.seed("app_config", "feedback_tracker", { emails: ["daniel@example.com"] });
    const fs = db.asFirestore();
    assert.equal(await setFeedbackAccess(fs, "admin1", "Steph@Example.com", true), true);
    assert.deepEqual(await readFeedbackAccessList(fs), ["daniel@example.com", "steph@example.com"]);
    assert.equal(db.docsIn("app_config")[0].data.updated_by, "admin1");
    assert.equal(await setFeedbackAccess(fs, "admin1", "steph@example.com", true), false);
    assert.equal(await setFeedbackAccess(fs, "admin1", "steph@example.com", false), true);
    assert.deepEqual(await readFeedbackAccessList(fs), ["daniel@example.com"]);
  });

  test("creates the list when there is none; refuses a missing email", async () => {
    const db = new FakeFirestore();
    const fs = db.asFirestore();
    assert.equal(await setFeedbackAccess(fs, "admin1", "joe@example.com", true), true);
    assert.deepEqual(await readFeedbackAccessList(fs), ["joe@example.com"]);
    await assert.rejects(() => setFeedbackAccess(fs, "admin1", "  ", true), /no email/);
  });
});
