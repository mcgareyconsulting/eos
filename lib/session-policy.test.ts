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
  test("sessions last 25 hours", () => {
    assert.equal(SESSION_MAX_AGE_MS, 25 * HOUR);
    assert.equal(sessionExpiresAtMs(claims), at(25));
  });

  test("renewal opens at the half-life", () => {
    assert.equal(sessionRenewAtMs(claims), at(12.5));
  });

  test("a fresh session is not renewed", () => {
    assert.equal(sessionNeedsRenewal(claims, at(0)), false);
    assert.equal(sessionNeedsRenewal(claims, at(12.49)), false);
  });

  test("a session past half its life is renewed", () => {
    assert.equal(sessionNeedsRenewal(claims, at(12.5)), true);
    assert.equal(sessionNeedsRenewal(claims, at(24.9)), true);
  });

  test("an expired session is neither valid nor renewable", () => {
    assert.equal(sessionWithinPolicy(claims, at(24.9)), true);
    assert.equal(sessionWithinPolicy(claims, at(25)), false);
    assert.equal(sessionNeedsRenewal(claims, at(25)), false);
    assert.equal(sessionNeedsRenewal(claims, at(60)), false);
  });

  test("a legacy 5-day cookie is held to 25 hours from issue", () => {
    const legacy = { iat, exp: iat + 5 * 24 * 3600 };
    assert.equal(sessionExpiresAtMs(legacy), at(25));
    assert.equal(sessionWithinPolicy(legacy, at(24)), true);
    assert.equal(sessionWithinPolicy(legacy, at(26)), false);
    assert.equal(sessionNeedsRenewal(legacy, at(13)), true);
  });

  test("a cookie shorter than the policy keeps its own exp", () => {
    const short = { iat, exp: iat + 2 * 3600 };
    assert.equal(sessionExpiresAtMs(short), at(2));
    assert.equal(sessionRenewAtMs(short), at(1));
  });
});
