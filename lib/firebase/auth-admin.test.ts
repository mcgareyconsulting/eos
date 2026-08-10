import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenIsAdmin } from "./admin-claim";
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
