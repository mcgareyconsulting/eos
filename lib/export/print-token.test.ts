import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { PRINT_TOKEN_COLLECTION, consumePrintToken, mintPrintToken } from "./print-token";

const now = new Date("2026-10-16T19:05:00Z");
const expect = { uid: "admin", exportId: "todos", now };

describe("print tokens", () => {
  test("mint → consume returns the bound params, once", async () => {
    const db = new FakeFirestore();
    const token = await mintPrintToken(db.asFirestore(), {
      uid: "admin",
      exportId: "todos",
      params: new URLSearchParams({ team: "t1", owner: "u2" }),
      now,
    });
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const first = await consumePrintToken(db.asFirestore(), token, expect);
    assert.ok(first.ok);
    assert.equal(first.params.toString(), "team=t1&owner=u2");
    const second = await consumePrintToken(db.asFirestore(), token, expect);
    assert.deepEqual(second, { ok: false, reason: "print_token_invalid" });
  });

  test("two racing requests: exactly one wins", async () => {
    const db = new FakeFirestore();
    const token = await mintPrintToken(db.asFirestore(), {
      uid: "admin",
      exportId: "todos",
      params: new URLSearchParams(),
      now,
    });
    const results = await Promise.all([
      consumePrintToken(db.asFirestore(), token, expect),
      consumePrintToken(db.asFirestore(), token, expect),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 0);
  });

  test("tokens are random", async () => {
    const db = new FakeFirestore();
    const input = { uid: "admin", exportId: "todos", params: new URLSearchParams(), now };
    const a = await mintPrintToken(db.asFirestore(), input);
    const b = await mintPrintToken(db.asFirestore(), input);
    assert.notEqual(a, b);
  });
});
