/**
 * Shared pre-provision helpers for inviting someone onto a team.
 * Used by leader "Add member" and admin "create team → invite leader".
 * Creates (or reuses) Auth + /users profile; does not send email.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { isEmailAllowed, parseAllowlist } from "@/lib/auth-allowlist";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function assertInviteEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error("Enter a valid email address");
  }
  const allowlist = parseAllowlist(process.env.SIGN_IN_ALLOWLIST);
  if (!isEmailAllowed(allowlist, normalized)) {
    throw new Error(
      "That email isn't on the sign-in allowlist for this app. Use a High Plains Bank address.",
    );
  }
  return normalized;
}

export async function ensureAuthUser(
  auth: Auth,
  opts: { email: string; firstName: string; lastName: string },
): Promise<string> {
  const existing = await auth.getUserByEmail(opts.email).catch(() => null);
  if (existing) return existing.uid;

  const created = await auth.createUser({
    email: opts.email,
    displayName: `${opts.firstName} ${opts.lastName}`.trim(),
  });
  return created.uid;
}

export async function writeMembership(
  db: Firestore,
  opts: {
    teamId: string;
    userId: string;
    role: "leader" | "member";
    firstName: string;
    lastName: string;
    email: string;
    /** If set, close a pending join request for this team+user. */
    decidedBy?: string;
  },
): Promise<void> {
  const fullName = `${opts.firstName} ${opts.lastName}`.trim();
  const memberRef = db
    .collection("team_members")
    .doc(`${opts.teamId}__${opts.userId}`);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    throw new Error("That person is already on this team");
  }

  const batch = db.batch();

  batch.set(
    db.collection("users").doc(opts.userId),
    {
      display_name: fullName,
      first_name: opts.firstName,
      last_name: opts.lastName,
      email: opts.email,
    },
    { merge: true },
  );

  batch.set(memberRef, {
    team_id: opts.teamId,
    user_id: opts.userId,
    role: opts.role,
    created_at: FieldValue.serverTimestamp(),
  });

  if (opts.decidedBy) {
    const requestRef = db
      .collection("team_join_requests")
      .doc(`${opts.teamId}__${opts.userId}`);
    const requestSnap = await requestRef.get();
    if (requestSnap.exists && requestSnap.data()?.status === "pending") {
      batch.update(requestRef, {
        status: "approved",
        decided_at: FieldValue.serverTimestamp(),
        decided_by: opts.decidedBy,
      });
    }
  }

  await batch.commit();
}
