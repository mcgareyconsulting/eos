// Grant or revoke the `eos_operator: true` custom claim.
//
// firestore.rules `authed()` admits a verified @highplainsbank.com email, or
// this claim. It is for the SIGN_IN_ALLOWLIST's exact-email entries (the
// consultant), which the server lets in but rules cannot see. Without it
// those accounts sign in fine and then every live listener is denied.
//
// Usage:
//   pnpm operator:set-claim --target prod --email consultant@example.com --apply
//   pnpm operator:set-claim --target prod --email … --off --apply
//
// Dry-run by default (no --apply). Merges into the existing claims, never
// replaces them (same shape as scripts/set-admin-role.ts). The client SDK
// picks the claim up on its next ID-token refresh (within the hour); signing
// out and back in applies it at once.

import "./lib/load-target"; // first: sets up env before anything reads it
import { getAdminAuth } from "../lib/firebase/admin";

function flag(argv: string[], name: string): string | true | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next !== undefined && !next.startsWith("--") ? next : true;
}

async function main() {
  const argv = process.argv.slice(2);
  const email = flag(argv, "email");
  if (typeof email !== "string") {
    console.error("Pass --email consultant@example.com");
    process.exit(1);
  }
  const on = flag(argv, "off") === undefined;
  const apply = flag(argv, "apply") !== undefined;

  if (on && email.toLowerCase().endsWith("@highplainsbank.com")) {
    console.error("HPB accounts pass the rules on their email; no claim needed.");
    process.exit(1);
  }

  const auth = getAdminAuth();
  const user = await auth.getUserByEmail(email.toLowerCase());
  const nextClaims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
  if (on) nextClaims.eos_operator = true;
  else delete nextClaims.eos_operator;

  console.log(`User:  ${user.email ?? "(no email)"}  (${user.uid})`);
  console.log(`Was:   ${JSON.stringify(user.customClaims ?? {})}`);
  console.log(`Next:  ${JSON.stringify(nextClaims)}`);
  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write the claim.");
    return;
  }

  await auth.setCustomUserClaims(user.uid, nextClaims);
  console.log("\n✓ Custom claims updated. Sign out and back in to apply it now.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
