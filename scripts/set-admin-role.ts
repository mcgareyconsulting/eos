// Grant or revoke the org-level Identity Platform custom claim
// `role: "admin"` (god-mode: all team data + create teams).
//
// Usage:
//   pnpm tsx scripts/set-admin-role.ts --email you@highplainsbank.com --apply
//   pnpm tsx scripts/set-admin-role.ts --email you@… --role normal --apply
//
// Dry-run by default (no --apply). User must sign out and back in after a
// claim change so the session cookie picks up the new token.

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminAuth } from "../lib/firebase/admin";

type Args = {
  email?: string;
  uid?: string;
  role: "admin" | "normal";
  apply: boolean;
};

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  const str = (k: string) => {
    const v = flags.get(k);
    return typeof v === "string" ? v : undefined;
  };

  const email = str("email")?.toLowerCase();
  const uid = str("uid");
  if (!email && !uid) {
    console.error(
      "Pass --email someone@highplainsbank.com or --uid <firebase-uid>",
    );
    process.exit(1);
  }

  const roleRaw = (str("role") ?? "admin").toLowerCase();
  if (roleRaw !== "admin" && roleRaw !== "normal") {
    console.error('--role must be "admin" or "normal"');
    process.exit(1);
  }

  return {
    email,
    uid,
    role: roleRaw,
    apply: flags.has("apply"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const auth = getAdminAuth();

  const user = args.uid
    ? await auth.getUser(args.uid)
    : await auth.getUserByEmail(args.email!);

  const existing = { ...(user.customClaims ?? {}) };
  const nextClaims =
    args.role === "admin"
      ? { ...existing, role: "admin" }
      : (() => {
          const { role: _drop, ...rest } = existing as {
            role?: string;
            [k: string]: unknown;
          };
          return rest;
        })();

  console.log(`User:  ${user.email ?? "(no email)"}  (${user.uid})`);
  console.log(`Was:   ${JSON.stringify(user.customClaims ?? {})}`);
  console.log(`Next:  ${JSON.stringify(nextClaims)}`);
  console.log(
    args.apply
      ? "\nApplying…"
      : "\nDry-run only. Re-run with --apply to write the claim.",
  );

  if (!args.apply) return;

  await auth.setCustomUserClaims(user.uid, nextClaims);
  console.log(
    "\n✓ Custom claims updated. Have the user sign out and sign back in so the session cookie refreshes.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
