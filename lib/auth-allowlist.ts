// Server-side sign-in allowlist.
//
// Why this exists: the access decision for the client's project is "HPB
// Workspace accounts plus the consultant's account, no one else" — which
// neither Firebase's provider-level domain restriction nor the client-side
// `hd` hint can express (both are single-domain, and `hd` only pre-filters
// the account chooser anyway). Enforcement therefore lives at the one
// chokepoint every session passes through: createSession() in
// lib/firebase/session.ts, driven by this parser.
//
// Format (SIGN_IN_ALLOWLIST env var): comma-separated entries.
//   "@highplainsbank.com, consultant@example.com"
// Entries starting with "@" allow the whole domain; anything else is an
// exact email. Matching is case-insensitive. Unset/empty = open sign-in
// — restriction is opt-in per deployment.

export type Allowlist = {
  domains: string[]; // without the leading "@", lowercase
  emails: string[]; // lowercase
};

export function parseAllowlist(raw: string | undefined | null): Allowlist | null {
  const entries = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
  if (entries.length === 0) return null; // open — no restriction configured

  const domains: string[] = [];
  const emails: string[] = [];
  for (const e of entries) {
    if (e.startsWith("@")) domains.push(e.slice(1));
    else emails.push(e);
  }
  return { domains, emails };
}

export function isEmailAllowed(
  allowlist: Allowlist | null,
  email: string | undefined | null,
): boolean {
  if (allowlist === null) return true; // open sign-in
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;

  if (allowlist.emails.includes(normalized)) return true;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return allowlist.domains.includes(domain);
}

export const NOT_AUTHORIZED_MESSAGE =
  "This account isn't authorized for this application. Sign in with your High Plains Bank account.";
export const EMAIL_UNVERIFIED_MESSAGE =
  "This account's email address isn't verified. Sign in with your High Plains Bank Google account.";

/**
 * The whole sign-in decision for a *verified* Firebase ID token: null to
 * admit, otherwise the message to show. Used by createSession(), session
 * renewal, and verifySession() on every request (against the decoded
 * cookie's claims), so all three apply exactly the same perimeter.
 *
 * `email_verified` must be literally `true` (C-04,
 * docs/SECURITY_AUDIT_2026-09-08.md). Google Workspace accounts always carry
 * it; it matters the day a second provider (SSO, email link) is enabled —
 * without it an unverified `anyone@highplainsbank.com` would pass the
 * allowlist on the address string alone. Checked regardless of whether an
 * allowlist is configured.
 */
export function signInRefusal(
  claims: { email?: string | null; email_verified?: boolean | null },
  allowlist: Allowlist | null,
): string | null {
  if (claims.email_verified !== true) return EMAIL_UNVERIFIED_MESSAGE;
  if (!isEmailAllowed(allowlist, claims.email)) return NOT_AUTHORIZED_MESSAGE;
  return null;
}
