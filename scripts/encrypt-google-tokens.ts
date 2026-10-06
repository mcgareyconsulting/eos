// Encrypt any Google Tasks refresh tokens still stored in plaintext (C-06).
//
// The app encrypts a legacy token itself the next time it refreshes it, so
// this is only for idle connections. It never prints a token.
//
// Usage (prod; dry-run lists uids only, --apply writes):
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID=hpb-eos-prod \
//   NEXT_PUBLIC_FIREBASE_DATABASE_ID=hpb-eos-prod-db \
//   GOOGLE_TOKENS_KMS_KEY=projects/hpb-eos-prod/locations/us-east1/keyRings/eos/cryptoKeys/eos-tokens \
//   pnpm tsx scripts/encrypt-google-tokens.ts [--apply]
//
// --apply needs encrypt (not decrypt) on the key for whoever runs it:
// roles/cloudkms.cryptoKeyEncrypter on eos-tokens — see docs/SECRETS_RUNBOOK.md.

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";
import { refreshTokenFields, tokenCipher } from "../lib/google/tasks";

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && !tokenCipher()) {
    console.error("GOOGLE_TOKENS_KMS_KEY is not set; nothing to encrypt with.");
    process.exit(1);
  }

  const snap = await getAdminDb().collection("google_tasks_connections").get();
  const legacy = snap.docs.filter((d) => {
    const data = d.data();
    return typeof data.refresh_token === "string" && data.refresh_token && !data.refresh_token_enc;
  });
  console.log(
    `${snap.size} connection(s); ${legacy.length} with a plaintext refresh token${apply ? "" : " (dry run)"}`,
  );

  let done = 0;
  for (const doc of legacy) {
    if (!apply) {
      console.log(`  would encrypt ${doc.id}`);
      continue;
    }
    const fields = await refreshTokenFields(doc.id, doc.data().refresh_token as string);
    await doc.ref.set(fields, { merge: true });
    done += 1;
    console.log(`  encrypted ${doc.id}`);
  }
  if (apply) console.log(`done: ${done} encrypted`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
