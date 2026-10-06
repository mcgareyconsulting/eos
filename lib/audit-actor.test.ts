import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { STAMP_FRESH_MS, resolveAuditActor } from "./audit-actor";

const NOW = Date.UTC(2026, 9, 6, 14, 2);

/** Stand-in for a Firestore Timestamp — only toMillis() is read. */
const ts = (ms: number) => ({ toMillis: () => ms });

const base = {
  authType: "service_account",
  authId: null,
  eventTimeMs: NOW,
};

describe("resolveAuditActor", () => {
  test("a client-SDK write keeps its own auth identity, whatever the doc says", () => {
    const r = resolveAuditActor({
      ...base,
      action: "update",
      authType: "api_key",
      authId: "jane",
      before: { title: "a" },
      after: { title: "b", updated_by: "mallory", updated_at: ts(NOW) },
    });
    assert.deepEqual(r, { actorUid: "jane", actorSource: "auth_context" });
  });

  test("a client write without auth never falls through to the stamp", () => {
    const r = resolveAuditActor({
      ...base,
      action: "update",
      authType: "unauthenticated",
      before: {},
      after: { updated_by: "mallory", updated_at: ts(NOW) },
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });

  test("Admin SDK update: the fresh updated_by is the actor", () => {
    const r = resolveAuditActor({
      ...base,
      action: "update",
      before: { title: "a", updated_by: "bob", updated_at: ts(NOW - 60_000) },
      after: { title: "b", updated_by: "jane", updated_at: ts(NOW) },
    });
    assert.deepEqual(r, { actorUid: "jane", actorSource: "stamp" });
  });

  test("two stamped writes in the same millisecond still count as a fresh stamp", () => {
    // Firestore Timestamps carry nanoseconds; toMillis() alone would collide.
    const at = (ns: number) => ({
      seconds: Math.floor(NOW / 1000),
      nanoseconds: ns,
      toMillis: () => NOW,
    });
    const r = resolveAuditActor({
      ...base,
      action: "update",
      before: { title: "a", updated_by: "bob", updated_at: at(1_000) },
      after: { title: "b", updated_by: "jane", updated_at: at(2_000) },
    });
    assert.deepEqual(r, { actorUid: "jane", actorSource: "stamp" });

    const untouched = resolveAuditActor({
      ...base,
      action: "update",
      before: { title: "a", updated_by: "bob", updated_at: at(1_000) },
      after: { title: "b", updated_by: "bob", updated_at: at(1_000) },
    });
    assert.deepEqual(untouched, { actorUid: null, actorSource: null });
  });

  test("authType unknown is treated as an Admin SDK write too", () => {
    const r = resolveAuditActor({
      ...base,
      action: "create",
      authType: "unknown",
      before: null,
      after: { updated_by: "jane", updated_at: ts(NOW) },
    });
    assert.deepEqual(r, { actorUid: "jane", actorSource: "stamp" });
  });

  test("Admin SDK update that didn't touch the stamp (sweep, Tasks pull) is unattributed", () => {
    const stampedAt = ts(NOW - 30_000);
    const r = resolveAuditActor({
      ...base,
      action: "update",
      before: { archived_at: null, updated_by: "jane", updated_at: stampedAt },
      after: { archived_at: ts(NOW), updated_by: "jane", updated_at: ts(NOW - 30_000) },
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });

  test("Admin SDK create with a stamp names its creator", () => {
    const r = resolveAuditActor({
      ...base,
      action: "create",
      before: null,
      after: { title: "x", updated_by: "jane", updated_at: ts(NOW) },
    });
    assert.deepEqual(r, { actorUid: "jane", actorSource: "stamp" });
  });

  test("a stamp copied verbatim from an old doc is too stale to trust", () => {
    const r = resolveAuditActor({
      ...base,
      action: "create",
      before: null,
      after: { updated_by: "jane", updated_at: ts(NOW - STAMP_FRESH_MS - 1) },
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });

  test("Admin SDK write with no stamp falls back to null, as before", () => {
    const r = resolveAuditActor({
      ...base,
      action: "update",
      before: { title: "a" },
      after: { title: "b" },
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });

  test("delete: before.deleted_by is the actor", () => {
    const r = resolveAuditActor({
      ...base,
      action: "delete",
      before: {
        title: "a",
        updated_by: "bob",
        updated_at: ts(NOW - 86_400_000),
        deleted_by: "jane",
        deleted_at: ts(NOW - 40),
      },
      after: null,
    });
    assert.deepEqual(r, { actorUid: "jane", actorSource: "stamp" });
  });

  test("delete never falls back to updated_by — the last editor isn't the deleter", () => {
    const r = resolveAuditActor({
      ...base,
      action: "delete",
      before: { updated_by: "bob", updated_at: ts(NOW - 10) },
      after: null,
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });

  test("delete: a leftover deleted_by from a stamp whose delete never ran is ignored", () => {
    const r = resolveAuditActor({
      ...base,
      action: "delete",
      before: { deleted_by: "jane", deleted_at: ts(NOW - 3_600_000) },
      after: null,
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });

  test("non-string or empty stamps are ignored", () => {
    for (const updated_by of ["", 42, null, { uid: "x" }]) {
      const r = resolveAuditActor({
        ...base,
        action: "create",
        before: null,
        after: { updated_by, updated_at: ts(NOW) },
      });
      assert.deepEqual(r, { actorUid: null, actorSource: null });
    }
  });

  test("a stamp without a readable timestamp is ignored", () => {
    const r = resolveAuditActor({
      ...base,
      action: "create",
      before: null,
      after: { updated_by: "jane", updated_at: "2026-10-06" },
    });
    assert.deepEqual(r, { actorUid: null, actorSource: null });
  });
});
