// Application-level encryption for Google OAuth refresh tokens (C-06,
// docs/SECURITY_AUDIT_2026-09-08.md).
//
// A refresh token is a long-lived credential for the user's Google account.
// Stored plaintext in `google_tasks_connections/{uid}`, it is readable by
// anyone with Firestore read access on the project — the runtime SA, the
// consultant, any future operator. Encrypting it with Cloud KMS means a
// reader also needs `cloudkms.cryptoKeyEncrypterDecrypter` on the
// `eos-tokens` key, which only the runtime service account holds
// (terraform/kms.tf), and every decrypt is a Cloud Audit Log entry.
//
// Design:
// - Direct KMS encrypt/decrypt rather than envelope encryption. A token is a
//   few hundred bytes (KMS accepts up to 64 KiB) and is decrypted once per
//   access-token refresh (hourly per connected user) — not worth a local DEK.
// - The user's uid is bound in as additional authenticated data, so a
//   ciphertext copied from one connection doc into another fails to decrypt.
// - The ciphertext names the key *version* that produced it, so KMS's 90-day
//   rotation needs no re-encryption: old versions stay enabled and decrypt.
// - Gated on GOOGLE_TOKEN_KMS_KEY (full key resource name). Unset means
//   plaintext storage as before — local dev, the sandbox, and prod until the
//   Gate 2 IAM grant is applied and verified. Once set, reads accept both
//   shapes and writes produce only the encrypted one, so existing
//   connections migrate on their next token refresh, or all at once with
//   `pnpm tsx scripts/encrypt-google-tokens.ts --apply`.

import { KeyManagementServiceClient } from "@google-cloud/kms";

export type SealedToken = {
  /** Base64 KMS ciphertext. */
  ciphertext: string;
  /** Crypto key *version* resource name that produced it (from KMS). */
  keyVersion: string;
};

/** The two KMS calls this module needs — the seam tests use to avoid KMS. */
export type TokenCipher = {
  encrypt(
    keyName: string,
    plaintext: Buffer,
    aad: Buffer,
  ): Promise<{ ciphertext: Buffer; keyVersion: string }>;
  decrypt(keyName: string, ciphertext: Buffer, aad: Buffer): Promise<Buffer>;
};

/** Full resource name of the key, or null when encryption is off. */
export function tokenKmsKey(): string | null {
  const v = process.env.GOOGLE_TOKEN_KMS_KEY?.trim();
  return v ? v : null;
}

/** Whether tokens written from now on are encrypted. */
export function tokenEncryptionEnabled(): boolean {
  return tokenKmsKey() !== null;
}

let kmsClient: KeyManagementServiceClient | null = null;

const kmsCipher: TokenCipher = {
  async encrypt(keyName, plaintext, aad) {
    kmsClient ??= new KeyManagementServiceClient();
    const [res] = await kmsClient.encrypt({
      name: keyName,
      plaintext,
      additionalAuthenticatedData: aad,
    });
    if (!res.ciphertext || !res.name) {
      throw new Error("KMS encrypt returned no ciphertext");
    }
    return { ciphertext: Buffer.from(res.ciphertext), keyVersion: res.name };
  },
  async decrypt(keyName, ciphertext, aad) {
    kmsClient ??= new KeyManagementServiceClient();
    const [res] = await kmsClient.decrypt({
      name: keyName,
      ciphertext,
      additionalAuthenticatedData: aad,
    });
    if (!res.plaintext) throw new Error("KMS decrypt returned no plaintext");
    return Buffer.from(res.plaintext);
  },
};

let cipherOverride: TokenCipher | null = null;

/** Test seam: swap the KMS calls for a fake. Pass null to restore. */
export function setTokenCipherForTests(cipher: TokenCipher | null): void {
  cipherOverride = cipher;
}

function cipher(): TokenCipher {
  return cipherOverride ?? kmsCipher;
}

function aadFor(uid: string): Buffer {
  return Buffer.from(`google_tasks_connections/${uid}`, "utf8");
}

/**
 * Encrypt a token for storage under `uid`'s connection doc. Throws when
 * encryption is off — callers decide the plaintext path explicitly via
 * `tokenEncryptionEnabled()` rather than silently falling back.
 */
export async function sealToken(
  uid: string,
  plaintext: string,
): Promise<SealedToken> {
  const key = tokenKmsKey();
  if (!key) throw new Error("GOOGLE_TOKEN_KMS_KEY is unset");
  const out = await cipher().encrypt(
    key,
    Buffer.from(plaintext, "utf8"),
    aadFor(uid),
  );
  return {
    ciphertext: out.ciphertext.toString("base64"),
    keyVersion: out.keyVersion,
  };
}

/**
 * Decrypt a stored token. Uses the key the ciphertext was made with (its
 * version is embedded in the ciphertext; the key name is enough), so a
 * rotation between write and read is fine. Throws when encryption is off:
 * an encrypted connection with no key configured is a deployment error, not
 * a disconnected user.
 */
export async function openToken(
  uid: string,
  sealed: SealedToken,
): Promise<string> {
  const key = tokenKmsKey();
  if (!key) {
    throw new Error(
      "Connection holds an encrypted token but GOOGLE_TOKEN_KMS_KEY is unset",
    );
  }
  const out = await cipher().decrypt(
    key,
    Buffer.from(sealed.ciphertext, "base64"),
    aadFor(uid),
  );
  return out.toString("utf8");
}
