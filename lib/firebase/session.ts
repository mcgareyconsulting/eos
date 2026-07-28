import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { isEmailAllowed, parseAllowlist } from "@/lib/auth-allowlist";
import { getAdminAuth } from "./admin";

const SESSION_COOKIE_NAME = "__firebase_session";
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

// Exchange a Firebase ID token (from signInWithPopup on the client) for a
// long-lived HttpOnly session cookie. ID token must be < 5 min old.
//
// This is the sign-in perimeter. When SIGN_IN_ALLOWLIST is set (e.g.
// "@highplainsbank.com,mcgareyconsulting@gmail.com"), only matching accounts
// get a session — enforced HERE because it's the one chokepoint every
// session passes through. The client-side `hd` hint only pre-filters
// Google's account chooser, and Firestore rules don't run for the admin-SDK
// reads that render pages, so neither is enforcement. Unset = open sign-in
// (trial behavior). See lib/auth-allowlist.ts.
export async function createSession(idToken: string): Promise<void> {
  const auth = getAdminAuth();

  const allowlist = parseAllowlist(process.env.SIGN_IN_ALLOWLIST);
  if (allowlist) {
    // Verify first so the email we gate on is the one Google attests,
    // not anything client-supplied.
    const decoded = await auth.verifyIdToken(idToken);
    if (!isEmailAllowed(allowlist, decoded.email)) {
      throw new Error(
        "This account isn't authorized for this application. Sign in with your High Plains Bank account.",
      );
    }
  }

  const sessionCookie = await auth.createSessionCookie(idToken, {
    expiresIn: FIVE_DAYS_MS,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, sessionCookie, {
    maxAge: FIVE_DAYS_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

// Returns the decoded token (uid, email, name, etc.) or null if no valid session.
// checkRevoked=true adds a Firebase Auth roundtrip — correct but slower.
export async function verifySession(): Promise<DecodedIdToken | null> {
  const store = await cookies();
  const sessionCookie = store.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  try {
    return await getAdminAuth().verifySessionCookie(sessionCookie, true);
  } catch {
    return null;
  }
}
