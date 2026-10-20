// The feedback tracker's gate (ROADMAP N73): every org admin, plus the
// people on a dedicated access list (lib/feedback/access.ts says why and
// where it lives).
//
// requireFeedbackTrackerAccess() is the tracker's requireAdmin(): the
// verified, revocation-checked session (requireFirebaseUser), then either
// the session's org-admin claim (as requireAdmin reads it), or the token's
// email — present, not marked unverified, lowercased — on
// `app_config/feedback_tracker.emails`. Anything else, including a missing
// doc, an empty list or a failed read for a non-admin, gets the same
// notFound() as every admin surface. Every tracker entry point calls it: lib/firebase/feedback.ts
// (so the data functions cannot be reached around it), the pages, the
// server actions, the screenshot route, and the sidebar link.
//
// Server only (Admin SDK).

import { cache } from "react";
import { notFound } from "next/navigation";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { getAdminAuth } from "./admin";
import { tokenIsAdmin } from "./admin-claim";
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
  /** The session's org-admin claim. */
  isAdmin?: boolean;
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
  return {
    ...user,
    emailVerified: token?.email_verified ?? null,
    isAdmin: token ? tokenIsAdmin(token) : false,
  };
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
  // Admins skip the list read entirely.
  if (user.isAdmin === true) return { user, allowed: true };
  return { user, allowed: hasFeedbackAccess(user, await readList(user.db)) };
});

/** Whether the signed-in person is an admin or on the list (the sidebar link). A missing session still redirects. */
export async function canUseFeedbackTracker(deps?: FeedbackDeps): Promise<boolean> {
  return (await evaluate(deps)).allowed;
}

/** The person, when an admin or listed; otherwise the admin surfaces' 404. */
export async function requireFeedbackTrackerAccess(deps?: FeedbackDeps): Promise<FeedbackUser> {
  const { user, allowed } = await evaluate(deps);
  if (!allowed) notFound();
  return user;
}

/** The fields of an Auth account the uid resolution reads. */
type AccountRecord = {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  customClaims?: Record<string, unknown>;
};

/**
 * The uids of the accounts on the list: an Auth account whose email — the
 * one its session token carries, which is what the gate above reads — is
 * listed, is not marked unverified, and is not disabled. Pure; exported for
 * tests.
 */
export function listedAccountUids(
  emails: readonly string[],
  accounts: readonly AccountRecord[],
): string[] {
  const out: string[] = [];
  for (const a of accounts) {
    if (a.disabled) continue;
    if (!hasFeedbackAccess({ email: a.email ?? null, emailVerified: a.emailVerified ?? null }, emails)) continue;
    if (!out.includes(a.uid)) out.push(a.uid);
  }
  return out;
}

/**
 * Who can use the tracker, as uids — what a feedback item's access subject
 * carries (lib/access/feedback.ts), so the shared thread, mention and
 * notification code can ask about a person by uid exactly as the gate asks
 * about the caller: every enabled org admin (one listUsers pass, as
 * getOrgAdmins does) plus the listed accounts (one Auth lookup per 100
 * emails). Fails closed: any failure is nobody.
 */
export async function feedbackAccessUids(
  db: Firestore,
  auth: () => Pick<Auth, "getUsers" | "listUsers"> = getAdminAuth,
): Promise<string[]> {
  try {
    const out: string[] = [];
    let page = await auth().listUsers(1000);
    for (;;) {
      for (const u of page.users as AccountRecord[]) {
        if (!u.disabled && u.customClaims?.role === "admin" && !out.includes(u.uid)) out.push(u.uid);
      }
      if (!page.pageToken) break;
      page = await auth().listUsers(1000, page.pageToken);
    }
    const emails = (await readList(db)) ?? [];
    const accounts: AccountRecord[] = [];
    for (let i = 0; i < emails.length; i += 100) {
      const res = await auth().getUsers(emails.slice(i, i + 100).map((email) => ({ email })));
      accounts.push(...res.users);
    }
    for (const uid of listedAccountUids(emails, accounts)) if (!out.includes(uid)) out.push(uid);
    return out;
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "feedback_access_uids_failed",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return [];
  }
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
