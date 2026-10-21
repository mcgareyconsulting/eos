// Feedback tracker access (ROADMAP N73; Daniel, 2026-10-19, admins added
// 2026-10-20): every org admin gets in, plus the people on a DEDICATED
// ACCESS LIST, so non-admins can be given the tracker without admin. Everyone
// who gets in sees and edits everything in the tracker. The admin half is
// lib/firebase/feedback-access.ts; this file is the list.
//
// The list is `app_config/feedback_tracker` = { emails, updated_at,
// updated_by }, read and written with the Admin SDK only (firestore.rules
// denies every client read and write on app_config). It is maintained with
// `pnpm feedback:access` (scripts/feedback-access.ts); no email lives in code.
//
// Pure: no Firestore, no React. The gate itself is
// lib/firebase/feedback-access.ts.

export const FEEDBACK_ACCESS_COLLECTION = "app_config";
export const FEEDBACK_ACCESS_DOC_ID = "feedback_tracker";

/** A deliberately simple shape check: one @, no spaces, a dot in the domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed + lowercased, or null when it isn't an email. */
export function normalizeAccessEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/**
 * The stored doc's list, normalized. Anything malformed (no doc, no array,
 * a non-email entry) is dropped, so a damaged doc can only shrink access.
 */
export function readAccessEmails(data: unknown): string[] {
  const emails = (data as { emails?: unknown } | null | undefined)?.emails;
  if (!Array.isArray(emails)) return [];
  const out: string[] = [];
  for (const raw of emails) {
    const e = normalizeAccessEmail(raw);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** What the gate knows about the signed-in person, from the session token. */
export type AccessIdentity = {
  email: string | null | undefined;
  /** The token's email_verified claim; undefined when the token has none. */
  emailVerified?: boolean | null;
};

/**
 * Whether this person is on the list (admins are let in before this is
 * asked). Fails closed: no list, an empty
 * list, no email claim, or an email the token says is unverified → no.
 * Case-insensitive on the email.
 */
export function hasFeedbackAccess(who: AccessIdentity, emails: readonly string[] | null): boolean {
  if (!emails || emails.length === 0) return false;
  if (who.emailVerified === false) return false;
  const email = normalizeAccessEmail(who.email);
  if (!email) return false;
  return emails.includes(email);
}

// ---------------------------------------------------------------------------
// The operator script's pure half (scripts/feedback-access.ts)
// ---------------------------------------------------------------------------

export type AccessArgs = {
  list: boolean;
  add: string[];
  remove: string[];
  apply: boolean;
  actor: string | null;
};

/**
 * `--list`, `--add <email>` / `--remove <email>` (repeatable), `--apply`,
 * `--actor <uid>`. Target flags (`--target`, `--env-file`) are the shared
 * loader's and are skipped here. Throws a readable Error for a bad call.
 */
export function parseAccessArgs(argv: readonly string[]): AccessArgs {
  const out: AccessArgs = { list: false, add: [], remove: [], apply: false, actor: null };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--list":
        out.list = true;
        break;
      case "--apply":
        out.apply = true;
        break;
      case "--add":
      case "--remove": {
        const raw = value(i, a);
        const e = normalizeAccessEmail(raw);
        if (!e) throw new Error(`${a}: "${raw}" is not an email address.`);
        (a === "--add" ? out.add : out.remove).push(e);
        i++;
        break;
      }
      case "--actor":
        out.actor = value(i, a);
        i++;
        break;
      case "--target":
      case "--env-file":
        i++;
        break;
      case "--":
        break;
      default:
        throw new Error(`Unknown argument "${a}".`);
    }
  }
  const both = out.add.filter((e) => out.remove.includes(e));
  if (both.length > 0) throw new Error(`Both added and removed: ${both.join(", ")}`);
  if (!out.list && out.add.length === 0 && out.remove.length === 0) {
    throw new Error("Nothing to do: pass --list, or --add / --remove <email>.");
  }
  if (out.apply && out.add.length === 0 && out.remove.length === 0) {
    throw new Error("--apply needs at least one --add or --remove.");
  }
  return out;
}

/** The list after the changes: existing order kept, additions appended, de-duplicated. */
export function applyAccessChanges(
  before: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const out = before.filter((e) => !remove.includes(e));
  for (const e of add) if (!out.includes(e)) out.push(e);
  return out;
}
