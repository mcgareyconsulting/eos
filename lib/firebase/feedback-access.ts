// The feedback tracker's gate (ROADMAP N73): a dedicated access list, not
// the org-admin role (lib/feedback/access.ts says why and where it lives).
//
// requireFeedbackTrackerAccess() is the tracker's requireAdmin(): the
// verified, revocation-checked session (requireFirebaseUser), then the
// token's email — present, not marked unverified, lowercased — must be on
// `app_config/feedback_tracker.emails`. Anything else, including a missing
// doc, an empty list or a failed read, gets the same notFound() as every
// admin surface. Every tracker entry point calls it: lib/firebase/feedback.ts
// (so the data functions cannot be reached around it), the pages, the
// server actions, the screenshot route, and the sidebar link.
//
// Server only (Admin SDK).

import { cache } from "react";
import { notFound } from "next/navigation";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getVerifiedSessionToken, requireFirebaseUser } from "./auth";
import {
  FEEDBACK_ACCESS_COLLECTION,
  FEEDBACK_ACCESS_DOC_ID,
  applyAccessChanges,
  hasFeedbackAccess,
  normalizeAccessEmail,
  readAccessEmails,
} from "@/lib/feedback/access";

/** Who is asking — requireFirebaseUser's shape plus the email_verified claim. */
export type FeedbackUser = {
  uid: string;
  email: string | null;
  /** The token's email_verified; undefined/null when the token has none. */
  emailVerified?: boolean | null;
  db: Firestore;
};

/** Test seam: production callers pass nothing. */
export type FeedbackDeps = {
  /** Resolves the signed-in person; throws (redirect/notFound) without a session. */
  user?: () => Promise<FeedbackUser>;
};

async function sessionUser(): Promise<FeedbackUser> {
  const user = await requireFirebaseUser();
  // Same cached verification requireFirebaseUser just used: no extra round trip.
  const token = await getVerifiedSessionToken();
  return { ...user, emailVerified: token?.email_verified ?? null };
}

/** The access list, or null when it cannot be read (fail closed). */
async function readList(db: Firestore): Promise<string[] | null> {
  try {
    const snap = await db.collection(FEEDBACK_ACCESS_COLLECTION).doc(FEEDBACK_ACCESS_DOC_ID).get();
    return snap.exists ? readAccessEmails(snap.data()) : null;
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "feedback_access_read_failed",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return null;
  }
}

/** One evaluation per request (React cache), shared by the sidebar and the page. */
const evaluate = cache(async (deps: FeedbackDeps = {}) => {
  const user = await (deps.user ?? sessionUser)();
  return { user, allowed: hasFeedbackAccess(user, await readList(user.db)) };
});

/** Whether the signed-in person is on the list (the sidebar link). A missing session still redirects. */
export async function canUseFeedbackTracker(deps?: FeedbackDeps): Promise<boolean> {
  return (await evaluate(deps)).allowed;
}

/** The person, when listed; otherwise the admin surfaces' 404. */
export async function requireFeedbackTrackerAccess(deps?: FeedbackDeps): Promise<FeedbackUser> {
  const { user, allowed } = await evaluate(deps);
  if (!allowed) notFound();
  return user;
}

/**
 * The access list for the Directory's Feedback chip (admins only). Empty when
 * there is no list or it cannot be read.
 */
export async function readFeedbackAccessList(db: Firestore): Promise<string[]> {
  return (await readList(db)) ?? [];
}

/**
 * Grant or remove tracker access for one email, as the Directory's Edit
 * person dialog does (the caller has already checked org admin). One
 * transaction over the list, stamped like the feedback:access script.
 * Returns whether the list changed.
 */
export async function setFeedbackAccess(
  db: Firestore,
  actorUid: string,
  email: string,
  on: boolean,
): Promise<boolean> {
  const normalized = normalizeAccessEmail(email);
  if (!normalized) throw new Error("This person has no email on file, so tracker access can't be set.");
  const ref = db.collection(FEEDBACK_ACCESS_COLLECTION).doc(FEEDBACK_ACCESS_DOC_ID);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const before = cur.exists ? readAccessEmails(cur.data()) : [];
    if (before.includes(normalized) === on) return false;
    const next = applyAccessChanges(before, on ? [normalized] : [], on ? [] : [normalized]);
    tx.set(ref, { emails: next, updated_at: FieldValue.serverTimestamp(), updated_by: actorUid });
    return true;
  });
}
