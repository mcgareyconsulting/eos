import { cookies } from "next/headers";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { parseAllowlist, signInRefusal } from "@/lib/auth-allowlist";
import {
  SESSION_MAX_AGE_MS,
  sessionNeedsRenewal,
  sessionWithinPolicy,
} from "@/lib/session-policy";
import { getAdminAuth } from "./admin";

const SESSION_COOKIE_NAME = "__firebase_session";

// Session lifecycle (C-05, docs/SECURITY_AUDIT_2026-09-08.md).
//
// - A cookie lives at most 12 hours (lib/session-policy.ts), and verifySession
//   holds every cookie to that from its own `iat` — including the 5-day
//   cookies minted before this policy.
// - Sliding renewal. A Firebase session cookie can't be extended; the only
//   way to get a new one is createSessionCookie() with a fresh ID token, and
//   only the signed-in browser holds one (the client SDK keeps the refresh
//   token). Server Components also can't set cookies. So the server decides
//   and the browser supplies the token: requireFirebaseUser() computes when
//   the verified session crosses its half-life, the app shell's
//   <SessionKeeper> waits for the user's next interaction after that point
//   and posts a fresh ID token to renewSession(), which re-checks everything
//   createSession() checks and re-mints the cookie. No per-request Firestore
//   or Auth writes: renewal costs one verify + one mint per active user per
//   ~6 hours. An idle user's cookie simply expires.
// - Sign-out revokes the user's Firebase refresh tokens before clearing the
//   cookie, so a copied cookie (or another device's session) stops working
//   too — verifySession checks revocation and the sign-in perimeter on every request.
//
// Test-only seam, same shape as lib/firebase/teams.ts: production callers
// never pass `deps`.
type SessionCookieStore = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: {
      maxAge: number;
      httpOnly: boolean;
      secure: boolean;
      path: string;
      sameSite: "lax";
    },
  ): unknown;
  delete(name: string): unknown;
};

export type SessionDeps = {
  auth?: () => Pick<
    Auth,
    | "verifyIdToken"
    | "createSessionCookie"
    | "verifySessionCookie"
    | "revokeRefreshTokens"
  >;
  cookies?: () => Promise<SessionCookieStore>;
  now?: () => number;
};

function authOf(deps: SessionDeps) {
  return (deps.auth ?? getAdminAuth)();
}

async function cookieStoreOf(deps: SessionDeps): Promise<SessionCookieStore> {
  return deps.cookies ? deps.cookies() : cookies();
}

// Verifies the ID token and applies the sign-in perimeter: a verified email
// (C-04) on the SIGN_IN_ALLOWLIST. Throws the user-facing refusal.
async function admit(
  deps: SessionDeps,
  idToken: string,
  checkRevoked: boolean,
): Promise<DecodedIdToken> {
  // Verify first so the claims we gate on are the ones Google attests, not
  // anything client-supplied.
  const decoded = await authOf(deps).verifyIdToken(idToken, checkRevoked);
  const refusal = signInRefusal(
    decoded,
    parseAllowlist(process.env.SIGN_IN_ALLOWLIST),
  );
  if (refusal) throw new Error(refusal);
  return decoded;
}

async function writeSessionCookie(deps: SessionDeps, idToken: string) {
  const sessionCookie = await authOf(deps).createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });
  const store = await cookieStoreOf(deps);
  store.set(SESSION_COOKIE_NAME, sessionCookie, {
    maxAge: SESSION_MAX_AGE_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
  });
}

// Exchange a Firebase ID token (from signInWithPopup on the client) for an
// HttpOnly session cookie (12 hours; see the lifecycle note above).
//
// This is the sign-in perimeter. When SIGN_IN_ALLOWLIST is set (e.g.
// "@highplainsbank.com,consultant@example.com"), only matching accounts
// get a session — enforced HERE because it's the one chokepoint every
// session passes through. The client-side `hd` hint only pre-filters
// Google's account chooser, and Firestore rules don't run for the admin-SDK
// reads that render pages, so neither is enforcement. Unset = open sign-in.
// The email must also be verified (C-04), allowlist or not.
// See lib/auth-allowlist.ts.
export async function createSession(
  idToken: string,
  deps: SessionDeps = {},
): Promise<void> {
  await admit(deps, idToken, false);
  await writeSessionCookie(deps, idToken);
}

/**
 * Re-mint the session cookie from a fresh ID token once the current session
 * is past its half-life. Returns whether a new cookie was written; a session
 * that is still fresh is left alone (and a missing or expired one is not
 * renewable — the user signs in again).
 *
 * The ID token must belong to the session's own user and pass the same
 * perimeter as sign-in. (Removal from SIGN_IN_ALLOWLIST already ends the
 * session on the next request via verifySession; a refused current session
 * returns false here, like an expired one.)
 */
export async function renewSession(
  idToken: string,
  deps: SessionDeps = {},
): Promise<boolean> {
  const current = await verifySession(deps);
  if (!current) return false;
  if (!sessionNeedsRenewal(current, (deps.now ?? Date.now)())) return false;
  const decoded = await admit(deps, idToken, true);
  if (decoded.uid !== current.uid) {
    throw new Error("Session renewal was refused for a different account.");
  }
  await writeSessionCookie(deps, idToken);
  return true;
}

/**
 * Sign-out: revoke the user's refresh tokens (every session cookie and client
 * refresh token issued before now stops verifying), then clear the cookie.
 * The cookie is cleared even if revocation fails — the caller is signing out
 * either way — and the failure is logged for follow-up.
 */
export async function endSession(deps: SessionDeps = {}): Promise<void> {
  const current = await verifyCookie(deps);
  try {
    if (current) await authOf(deps).revokeRefreshTokens(current.uid);
  } catch (e) {
    console.error("[session] revokeRefreshTokens failed on sign-out:", e);
  } finally {
    await clearSession(deps);
  }
}

export async function clearSession(deps: SessionDeps = {}): Promise<void> {
  const store = await cookieStoreOf(deps);
  store.delete(SESSION_COOKIE_NAME);
}

// Cryptographic + lifetime check only: the cookie is genuine, unrevoked and
// inside the 12-hour policy. No perimeter check — endSession() uses this so
// someone just removed from the allowlist can still have their refresh
// tokens revoked on sign-out.
async function verifyCookie(deps: SessionDeps): Promise<DecodedIdToken | null> {
  const store = await cookieStoreOf(deps);
  const sessionCookie = store.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  try {
    const decoded = await authOf(deps).verifySessionCookie(sessionCookie, true);
    return sessionWithinPolicy(decoded, (deps.now ?? Date.now)())
      ? decoded
      : null;
  } catch {
    return null;
  }
}

// Returns the decoded token (uid, email, name, etc.) or null if no valid session.
// checkRevoked=true adds a Firebase Auth roundtrip — correct but slower.
// A cookie older than the 12-hour policy is refused whatever its own `exp`.
//
// Every request re-applies the sign-in perimeter (verified email +
// SIGN_IN_ALLOWLIST) to the claims already in the cookie, so removing someone
// from the allowlist ends their session on their next request rather than at
// the next renewal. It costs no network call: the claims are in the decoded
// cookie and the allowlist is an in-memory env read. A refused session
// behaves exactly like an expired one (null -> redirect to /login). Every
// session read in the app goes through here (requireFirebaseUser, the Tasks
// routes, the login page); proxy.ts only checks cookie presence.
export async function verifySession(
  deps: SessionDeps = {},
): Promise<DecodedIdToken | null> {
  const decoded = await verifyCookie(deps);
  if (!decoded) return null;
  const refusal = signInRefusal(
    decoded,
    parseAllowlist(process.env.SIGN_IN_ALLOWLIST),
  );
  return refusal ? null : decoded;
}
