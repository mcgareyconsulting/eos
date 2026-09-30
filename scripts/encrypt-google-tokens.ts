// One-shot migration for C-06: re-write every `google_tasks_connections/{uid}`
// row that still holds a plaintext `refresh_token` as a KMS-encrypted
// `refresh_token_enc` (+ `refresh_token_key`), and clear the plaintext.
//
// Usage:
//   GOOGLE_TOKEN_KMS_KEY=projects/hpb-eos-prod/locations/us-east1/keyRings/eos/cryptoKeys/eos-tokens \
//   pnpm tsx scripts/encrypt-google-tokens.ts                # dry run: counts only
//   ... pnpm tsx scripts/encrypt-google-tokens.ts --apply    # write
//
// Needs cloudkms.cryptoKeyEncrypterDecrypter on the key for whatever
// credentials run this (ADC). Without the flag the app migrates rows lazily
// on their next token refresh anyway; this just finishes the job in one go so
// no plaintext row lingers for a rarely-used connection. Idempotent: rows
// already encrypted are skipped. Never prints a token.

import { config } from "dotenv";
config({ path: ".env.local" });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";
import { sealToken, tokenEncryptionEnabled } from "../lib/google/token-crypto";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!tokenEncryptionEnabled()) {
    console.error("GOOGLE_TOKEN_KMS_KEY is unset — nothing to encrypt with.");
    process.exit(1);
  }

  const db = getAdminDb();
  const snap = await db.collection("google_tasks_connections").get();
  let plaintext = 0;
  let encrypted = 0;
  let empty = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.refresh_token_enc) {
      encrypted += 1;
      continue;
    }
    if (typeof data.refresh_token !== "string" || !data.refresh_token) {
      empty += 1;
      continue;
    }
    plaintext += 1;
    if (!apply) continue;

    const sealed = await sealToken(doc.id, data.refresh_token);
    await doc.ref.set(
      {
        refresh_token: FieldValue.delete(),
        refresh_token_enc: sealed.ciphertext,
        refresh_token_key: sealed.keyVersion,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`encrypted google_tasks_connections/${doc.id}`);
  }

  console.log(
    `${apply ? "Encrypted" : "Would encrypt"} ${plaintext} row(s); ${encrypted} already encrypted; ${empty} with no refresh token.`,
  );
  if (!apply && plaintext > 0) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
