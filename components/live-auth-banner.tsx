"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthUid } from "@/lib/firebase/use-collection";

/**
 * Dual-auth footgun: pages render via the HttpOnly session cookie (admin
 * SDK), but live Firestore listeners need the *client* Firebase Auth
 * session from signInWithPopup. If the cookie is valid and client auth is
 * gone (cleared storage, different browser profile, expired IndexedDB),
 * the app looks signed-in but votes / scorecard live cells / segment
 * advance stick on SSR snapshots — reported as "system access" issues.
 *
 * This banner only appears after auth has settled and client uid is null.
 * Full page loads still work; only realtime is degraded.
 */
export function LiveAuthBanner() {
  const uid = useAuthUid();
  // Avoid a flash on first paint while Firebase restores from persistence.
  // Adjusted during render rather than in an effect: once auth has reported
  // at all, the banner is allowed to decide, and it stays decided.
  const [settled, setSettled] = useState(false);
  if (!settled && uid !== undefined) setSettled(true);

  if (!settled || uid) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      Live updates are unavailable in this browser session.{" "}
      <Link
        href="/login"
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        Sign in again
      </Link>{" "}
      to restore real-time voting, scorecard edits, and meeting sync.
    </div>
  );
}
