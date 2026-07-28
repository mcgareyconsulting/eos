// Pre-creates Firebase Auth accounts so imported data can be keyed to the
// real people before any of them has signed in.
//
// Why this exists: import-csv assigns rows whose Owner it can't match to a
// placeholder member (`import-jane-doe`). When Jane later signs in with
// Google she gets a *different* uid, so her rocks and to-dos stay attached to
// the placeholder and her Home dashboard comes up empty. Creating the account
// first means the uid exists up front — `--owner-alias` can point her CSV
// name at it, and Google links to that same account on first sign-in because
// the project has allowDuplicateEmails disabled.
//
// Creating an account does NOT notify anyone: no email is sent, no password
// is set. It's an empty record waiting for the person to sign in with Google.
//
// Usage:
//   pnpm accounts:create "Cora Ravenkamp <cora@bank.com>" "Jane Doe <jane@bank.com>"
//   pnpm accounts:create --dry-run "Cora Ravenkamp <cora@bank.com>"
//
// Options:
//   --dry-run        Report what would happen. Creates nothing.
//   --project <id>   Firebase project, overriding .env.local.
//
// Idempotent: an email that already has an account is reported and left
// exactly as-is — never modified, never re-created.

import { pathToFileURL } from "node:url";
import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminAuth } from "../lib/firebase/admin";

type Person = { name: string | null; email: string };

// Accepts "Full Name <a@b.com>" (paste straight from an email client) or a
// bare address.
export function parsePerson(raw: string): Person | null {
  const s = raw.trim().replace(/,$/, "");
  if (!s) return null;

  const angled = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, "");
    return { name: name || null, email: angled[2].trim().toLowerCase() };
  }
  if (s.includes("@") && !/\s/.test(s)) {
    return { name: null, email: s.toLowerCase() };
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const projectIdx = argv.indexOf("--project");
  if (projectIdx !== -1 && argv[projectIdx + 1]) {
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = argv[projectIdx + 1];
  }

  const raw = argv.filter(
    (a, i) =>
      !a.startsWith("--") && !(projectIdx !== -1 && i === projectIdx + 1),
  );

  const people: Person[] = [];
  for (const r of raw) {
    const p = parsePerson(r);
    if (!p) {
      console.error(`Not a recognizable address: "${r}"`);
      console.error('Expected `Full Name <someone@example.com>` or `someone@example.com`.');
      process.exit(1);
    }
    people.push(p);
  }

  if (people.length === 0) {
    console.error(
      'Nothing to do — pass one or more people:\n' +
        '  pnpm accounts:create "Cora Ravenkamp <cora.ravenkamp@highplainsbank.com>"',
    );
    process.exit(1);
  }

  const auth = getAdminAuth();
  console.log(
    `\nProject: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}` +
      `${dryRun ? "   [DRY RUN — nothing will be created]" : ""}\n`,
  );

  let created = 0;
  let existing = 0;

  for (const p of people) {
    const found = await auth.getUserByEmail(p.email).catch(() => null);
    if (found) {
      console.log(
        `  exists   ${p.email}  (uid ${found.uid}` +
          `${found.metadata.lastSignInTime ? ", has signed in" : ", never signed in"})`,
      );
      existing++;
      continue;
    }

    if (dryRun) {
      console.log(`  would create  ${p.email}${p.name ? `  (${p.name})` : ""}`);
      created++;
      continue;
    }

    // emailVerified stays false: nothing here verifies the address, and
    // Google will set it on first sign-in.
    const user = await auth.createUser({
      email: p.email,
      ...(p.name ? { displayName: p.name } : {}),
    });
    console.log(`  created  ${p.email}  (uid ${user.uid})${p.name ? `  ${p.name}` : ""}`);
    created++;
  }

  console.log(
    `\n${dryRun ? "Would create" : "Created"} ${created}, ${existing} already existed.`,
  );
  if (!dryRun && created > 0) {
    console.log(
      "\nNo one was emailed — these are empty records that activate on first\n" +
        "Google sign-in. Point imported rows at them with:\n" +
        '  pnpm import:csv ... --member <email> --owner-alias "CSV Name=<email>"',
    );
  }
}

// Only run the CLI when invoked directly. The test file imports parsePerson
// from here, and an unguarded main() would fire on import — exiting the test
// process before a single assertion ran.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
