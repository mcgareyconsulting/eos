// Google refresh tokens encrypted with Cloud KMS before they reach Firestore
// (C-06, docs/SECURITY_AUDIT_2026-09-08.md).
//
// Direct KMS encrypt/decrypt, not envelope encryption: a refresh token is a
// few hundred bytes (KMS takes up to 64 KiB), so there's no data key to
// manage and the key material never leaves KMS. Reading Firestore alone no
// longer yields a usable token — decrypting also needs
// `cloudkms.cryptoKeyVersions.useToDecrypt` on the key, which Terraform grants
// to the runtime service account only (terraform/kms.tf).
//
// The ciphertext is bound to its document with additional authenticated data
// (`google_tasks_connections/<uid>`), so a ciphertext copied onto another
// user's connection doc fails to decrypt instead of acting as that user.
//
// Plain fetch against the KMS REST API, like the rest of the connector: the
// access token comes from firebase-admin's credential (ADC on Cloud Run, which
// carries the cloud-platform scope), so no extra SDK dependency.

const KMS_BASE = "https://cloudkms.googleapis.com/v1";

/** Full resource name of the `eos-tokens` key (Terraform output `tokens_kms_key_id`). */
export const TOKENS_KMS_KEY_ENV = "GOOGLE_TOKENS_KMS_KEY";

export type EncryptedToken = {
  /** Base64 KMS ciphertext. */
  ciphertext: string;
  /** Key version that encrypted it (audit / rotation evidence). */
  keyVersion: string;
};

export type TokenCipher = {
  encrypt(plaintext: string, aad: string): Promise<EncryptedToken>;
  decrypt(ciphertext: string, aad: string): Promise<string>;
};

/** AAD binding a stored token to its connection doc. */
export function tokenAad(uid: string): string {
  return `google_tasks_connections/${uid}`;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export function kmsTokenCipher(
  keyName: string,
  getAccessToken: () => Promise<string>,
): TokenCipher {
  async function call(op: "encrypt" | "decrypt", body: Record<string, string>) {
    const res = await fetch(`${KMS_BASE}/${keyName}:${op}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Never echo the request body: it holds the token (encrypt) or its
      // ciphertext (decrypt).
      throw new Error(`KMS ${op} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    async encrypt(plaintext, aad) {
      const json = await call("encrypt", {
        plaintext: b64(plaintext),
        additionalAuthenticatedData: b64(aad),
      });
      if (typeof json.ciphertext !== "string") {
        throw new Error("KMS encrypt returned no ciphertext");
      }
      return {
        ciphertext: json.ciphertext,
        keyVersion: typeof json.name === "string" ? json.name : keyName,
      };
    },
    async decrypt(ciphertext, aad) {
      const json = await call("decrypt", {
        ciphertext,
        additionalAuthenticatedData: b64(aad),
      });
      if (typeof json.plaintext !== "string") {
        throw new Error("KMS decrypt returned no plaintext");
      }
      return Buffer.from(json.plaintext, "base64").toString("utf8");
    },
  };
}
