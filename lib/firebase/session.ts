import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "./admin";

const SESSION_COOKIE_NAME = "__firebase_session";
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

// Exchange a Firebase ID token (from signInWithPopup on the client) for a
// long-lived HttpOnly session cookie. ID token must be < 5 min old.
export async function createSession(idToken: string): Promise<void> {
  const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
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
