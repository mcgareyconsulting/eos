import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_MAX_AGE_MS,
  sessionExpiresAtMs,
  sessionNeedsRenewal,
  sessionRenewAtMs,
  sessionWithinPolicy,
} from "./session-policy";

const HOUR = 60 * 60 * 1000;
const iat = 1_800_000_000; // seconds
const claims = { iat, exp: iat + SESSION_MAX_AGE_MS / 1000 };
const at = (hours: number) => iat * 1000 + hours * HOUR;

describe("session policy", () => {
  test("sessions last 12 hours", () => {
    assert.equal(SESSION_MAX_AGE_MS, 12 * HOUR);
    assert.equal(sessionExpiresAtMs(claims), at(12));
  });

  test("renewal opens at the half-life", () => {
    assert.equal(sessionRenewAtMs(claims), at(6));
  });

  test("a fresh session is not renewed", () => {
    assert.equal(sessionNeedsRenewal(claims, at(0)), false);
    assert.equal(sessionNeedsRenewal(claims, at(5.99)), false);
  });

  test("a session past half its life is renewed", () => {
    assert.equal(sessionNeedsRenewal(claims, at(6)), true);
    assert.equal(sessionNeedsRenewal(claims, at(11.9)), true);
  });

  test("an expired session is neither valid nor renewable", () => {
    assert.equal(sessionWithinPolicy(claims, at(11.9)), true);
    assert.equal(sessionWithinPolicy(claims, at(12)), false);
    assert.equal(sessionNeedsRenewal(claims, at(12)), false);
    assert.equal(sessionNeedsRenewal(claims, at(30)), false);
  });

  test("a legacy 5-day cookie is held to 12 hours from issue", () => {
    const legacy = { iat, exp: iat + 5 * 24 * 3600 };
    assert.equal(sessionExpiresAtMs(legacy), at(12));
    assert.equal(sessionWithinPolicy(legacy, at(11)), true);
    assert.equal(sessionWithinPolicy(legacy, at(13)), false);
    assert.equal(sessionNeedsRenewal(legacy, at(7)), true);
  });

  test("a cookie shorter than the policy keeps its own exp", () => {
    const short = { iat, exp: iat + 2 * 3600 };
    assert.equal(sessionExpiresAtMs(short), at(2));
    assert.equal(sessionRenewAtMs(short), at(1));
  });
});
