import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenIsAdmin } from "./admin-claim";
import { assertNoServiceAccountKey } from "./admin";
import type { DecodedIdToken } from "firebase-admin/auth";

function fakeToken(claims: Record<string, unknown>): DecodedIdToken {
  return claims as unknown as DecodedIdToken;
}

describe("tokenIsAdmin", () => {
  it("is true only for role admin", () => {
    assert.equal(tokenIsAdmin(fakeToken({ role: "admin" })), true);
    assert.equal(tokenIsAdmin(fakeToken({ role: "normal" })), false);
    assert.equal(tokenIsAdmin(fakeToken({})), false);
  });
});

describe("assertNoServiceAccountKey", () => {
  it("throws pointing at ADC when the legacy key var is set", () => {
    assert.throws(
      () => assertNoServiceAccountKey({ FIREBASE_SERVICE_ACCOUNT_JSON: "{}" }),
      /Application Default Credentials/,
    );
  });
  it("passes when unset or empty", () => {
    assertNoServiceAccountKey({});
    assertNoServiceAccountKey({ FIREBASE_SERVICE_ACCOUNT_JSON: "" });
  });
});
