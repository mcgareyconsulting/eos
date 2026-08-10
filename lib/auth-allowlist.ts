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
//   "@highplainsbank.com, daniel@mcgareyconsulting.com"
// Entries starting with "@" allow the whole domain; anything else is an
// exact email. Matching is case-insensitive. Unset/empty = open sign-in
// (the trial's historical behavior) — restriction is opt-in per deployment.

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
