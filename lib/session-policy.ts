// Session lifetime policy (C-05, docs/SECURITY_AUDIT_2026-09-08.md).
//
// A session cookie lives at most 12 hours. While the user is active it
// slides: once a cookie has used up half its life, the next activity in the
// app re-mints a fresh 12-hour cookie. Someone who walks away for more than
// 12 hours — overnight, in practice — signs in again. See
// lib/firebase/session.ts for where the re-mint happens and why.
//
// Every limit is measured from the cookie's own `iat`, not trusted from its
// `exp`, so the 5-day cookies minted before this policy stop working 12 hours
// after they were issued rather than lingering for days.
//
// Pure (no Firebase, no cookies) so the arithmetic is unit-tested.

export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The `iat`/`exp` claims (seconds) of a decoded Firebase session cookie. */
export type SessionClaims = { iat: number; exp: number };

/** Epoch ms at which the session stops being accepted. */
export function sessionExpiresAtMs(claims: SessionClaims): number {
  return Math.min(claims.exp * 1000, claims.iat * 1000 + SESSION_MAX_AGE_MS);
}

/** Epoch ms after which the session should be renewed: its half-life. */
export function sessionRenewAtMs(claims: SessionClaims): number {
  return (claims.iat * 1000 + sessionExpiresAtMs(claims)) / 2;
}

/** False once the session has outlived the policy (whatever its `exp`). */
export function sessionWithinPolicy(
  claims: SessionClaims,
  nowMs: number,
): boolean {
  return nowMs < sessionExpiresAtMs(claims);
}

/**
 * True when a still-valid session has less than half its life left. An
 * expired session is not renewable — the user signs in again.
 */
export function sessionNeedsRenewal(
  claims: SessionClaims,
  nowMs: number,
): boolean {
  return nowMs >= sessionRenewAtMs(claims) && sessionWithinPolicy(claims, nowMs);
}
