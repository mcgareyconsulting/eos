"use client";

import { useEffect, useRef } from "react";
import { getClientAuth } from "@/lib/firebase/client";
import { SESSION_MAX_AGE_MS } from "@/lib/session-policy";
import { renewSessionAction } from "@/app/(app)/session-actions";

// Activity that counts as "the user is here". No throttle needed: until the
// half-life passes, each event costs one clock comparison.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "focus", "visibilitychange"] as const;
const RETRY_MS = 5 * 60 * 1000;

/**
 * Sliding 12-hour session (C-05; lib/firebase/session.ts). Renders nothing.
 *
 * The server says how long until the session's half-life (`renewInMs`). After
 * that, the next interaction asks the client Firebase SDK for an ID token and
 * posts it to renewSessionAction, which re-mints the cookie. An idle tab does
 * nothing, so an unattended session still expires 12 hours after its last
 * renewal. If client auth is gone (LiveAuthBanner's case) there is no token
 * to send; the cookie runs out and the user signs in again.
 */
export function SessionKeeper({ renewInMs }: { renewInMs: number }) {
  const renewAt = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    // Measured on this device's clock from mount, so client/server clock skew
    // can't make the tab renew early or never.
    renewAt.current = Date.now() + renewInMs;
  }, [renewInMs]);

  useEffect(() => {
    async function maybeRenew() {
      if (document.visibilityState === "hidden") return;
      if (inFlight.current || renewAt.current === null) return;
      if (Date.now() < renewAt.current) return;
      const user = getClientAuth().currentUser;
      if (!user) return;
      inFlight.current = true;
      try {
        const idToken = await user.getIdToken();
        const res = await renewSessionAction(idToken);
        renewAt.current =
          res.ok && res.renewed
            ? Date.now() + SESSION_MAX_AGE_MS / 2
            : Date.now() + RETRY_MS;
      } catch {
        renewAt.current = Date.now() + RETRY_MS;
      } finally {
        inFlight.current = false;
      }
    }
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, maybeRenew, { passive: true });
    }
    return () => {
      for (const e of ACTIVITY_EVENTS) {
        window.removeEventListener(e, maybeRenew);
      }
    };
  }, []);

  return null;
}
