"use server";

import { renewSession } from "@/lib/firebase/session";

/**
 * Sliding-session renewal (C-05): the browser posts a fresh Firebase ID token
 * once the session is past its half-life, and gets a new 12-hour cookie. See
 * lib/firebase/session.ts. `renewed: false` means nothing needed doing.
 */
export async function renewSessionAction(
  idToken: string,
): Promise<{ ok: true; renewed: boolean } | { ok: false }> {
  try {
    return { ok: true, renewed: await renewSession(idToken) };
  } catch (e) {
    console.error("[session] renewal refused:", e);
    return { ok: false };
  }
}
