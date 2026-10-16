// Single-use print tokens (docs/EXPORT.md, "Print / PDF").
//
// Rendering the print view IS an export — it reads the view and writes an
// audit row — so a plain GET of /print/{id}?<params> would be a
// state-changing GET: a cross-site link opened by a signed-in admin (the
// session cookie is SameSite=Lax, which a top-level navigation carries)
// would export and audit on their behalf. Instead the Export control POSTs
// (same-origin only) to mint a token, and the print page renders only for a
// valid, unused one:
//
//   - 32 random bytes, base64url. Only its SHA-256 is stored, so a leaked
//     Firestore read can't replay one.
//   - Bound to the admin's uid, the export id and the exact query string;
//     the print page takes its view from the token, never from its own URL.
//   - Lives PRINT_TOKEN_TTL_MS (2 minutes) — long enough for the new tab to
//     load, short enough that a stray URL is dead by the time anyone sees it.
//   - Single use: consumed by `delete({ exists: true })`, which only one of
//     two racing requests can win. A failed check (wrong uid, wrong export,
//     expired) still burns it.
//
// Same pattern as oauth_csrf_states (lib/google/tasks.ts): an Admin SDK
// collection clients can never touch (firestore.rules), skipped by the
// generic audit trigger (functions/src/index.ts AUDIT_EXCLUDED_COLLECTIONS).
// `expires_at` is a Timestamp so a Firestore TTL policy can sweep tokens that
// were minted and never opened.

import { createHash, randomBytes } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

export const PRINT_TOKEN_COLLECTION = "export_print_tokens";
export const PRINT_TOKEN_TTL_MS = 2 * 60 * 1000;

// base64url of 32 bytes is 43 characters.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function tokenRef(db: Firestore, token: string) {
  const id = createHash("sha256").update(token).digest("hex");
  return db.collection(PRINT_TOKEN_COLLECTION).doc(id);
}

type TokenDoc = {
  uid?: unknown;
  export_id?: unknown;
  params?: unknown;
  expires_at?: { toMillis?: () => number };
};

/** Mint a token for this admin, export and view. Returns the raw token. */
export async function mintPrintToken(
  db: Firestore,
  input: { uid: string; exportId: string; params: URLSearchParams; now: Date },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tokenRef(db, token).create({
    uid: input.uid,
    export_id: input.exportId,
    params: input.params.toString(),
    expires_at: Timestamp.fromMillis(input.now.getTime() + PRINT_TOKEN_TTL_MS),
    created_at: FieldValue.serverTimestamp(),
  });
  return token;
}

export type PrintTokenProblem =
  | "print_token_missing"
  | "print_token_invalid"
  | "print_token_expired"
  | "print_token_mismatch";

export type ConsumedPrintToken =
  | { ok: true; params: URLSearchParams }
  | { ok: false; reason: PrintTokenProblem };

/**
 * Spend `token`. Valid only when it exists, hasn't been spent, hasn't
 * expired, and was minted for this uid and export. Any token that exists is
 * deleted whatever the verdict, so none can be tried twice.
 */
export async function consumePrintToken(
  db: Firestore,
  token: string | null | undefined,
  expect: { uid: string; exportId: string; now: Date },
): Promise<ConsumedPrintToken> {
  if (!token) return { ok: false, reason: "print_token_missing" };
  if (!TOKEN_RE.test(token)) return { ok: false, reason: "print_token_invalid" };

  const ref = tokenRef(db, token);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "print_token_invalid" };
  try {
    await ref.delete({ exists: true });
  } catch {
    // Another request spent it between our read and our delete.
    return { ok: false, reason: "print_token_invalid" };
  }

  const data = (snap.data() ?? {}) as TokenDoc;
  const expiresAt =
    typeof data.expires_at?.toMillis === "function" ? data.expires_at.toMillis() : 0;
  if (!(expiresAt > expect.now.getTime())) return { ok: false, reason: "print_token_expired" };
  if (data.uid !== expect.uid || data.export_id !== expect.exportId) {
    return { ok: false, reason: "print_token_mismatch" };
  }
  return {
    ok: true,
    params: new URLSearchParams(typeof data.params === "string" ? data.params : ""),
  };
}
