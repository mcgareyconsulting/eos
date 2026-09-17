// Seeds people, teams, memberships and org-admin claims from a
// First Name / Last Name / Team / Role access / Email file.
//
// Same importer the admin console's "Import seed file" page runs
// (`lib/user-import`) — this is the operator-side entry point for when the
// file is large, the app isn't deployed yet, or the run wants to be scripted.
//
// Usage:
//   pnpm users:seed ./people.csv                 # dry run — writes nothing
//   pnpm users:seed ./people.csv --apply
//
// Options:
//   --apply              Actually write. Without it this is a dry run.
//   --database <id>      Firestore database (e.g. hpb-eos-sandbox-db).
//   --project <id>       Firebase project, overriding .env.local.
//   --no-allowlist       Skip the SIGN_IN_ALLOWLIST check (sandbox only —
//                        it creates accounts that cannot sign in).
//
// Additive and idempotent: people match on email, teams on name. Re-running
// the same file adds only what is new, and never removes anyone or changes an
// existing member's role. See lib/user-import/run.ts.

import { readFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });

import { parseAllowlist } from "../lib/auth-allowlist";
import { getAdminAuth, getAdminDb } from "../lib/firebase/admin";
import { tableFromBytes } from "../lib/team-import";
import { runUserImport } from "../lib/user-import";

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const noAllowlist = argv.includes("--no-allowlist");

  const project = argValue(argv, "--project");
  if (project) process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = project;
  const database = argValue(argv, "--database");
  if (database) process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = database;

  const flagValues = new Set(
    ["--project", "--database"].map((f) => argValue(argv, f)).filter(Boolean),
  );
  const path = argv.find((a) => !a.startsWith("--") && !flagValues.has(a));

  if (!path) {
    console.error(
      "Pass the seed file:\n" +
        "  pnpm users:seed ./people.csv            (dry run)\n" +
        "  pnpm users:seed ./people.csv --apply",
    );
    process.exit(1);
  }

  const table = tableFromBytes(
    readFileSync(path),
    path,
    /people|user|member|roster|directory|staff|employee|team/i,
  );

  console.log(
    `\nProject:  ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}\n` +
      `Database: ${process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "(default)"}\n` +
      `File:     ${path} — ${table.rows.length} data rows` +
      `${apply ? "" : "\n\n[DRY RUN — nothing will be written]"}\n`,
  );

  const report = await runUserImport(getAdminDb(), getAdminAuth(), table, {
    dryRun: !apply,
    allowlist: noAllowlist ? null : parseAllowlist(process.env.SIGN_IN_ALLOWLIST),
  });

  for (const row of report.rows) {
    console.log(
      `  ${row.action.padEnd(6)} ${row.name.padEnd(24)} ${row.email.padEnd(32)} ` +
        `${row.team.padEnd(20)} ${row.orgAdmin ? "ORG ADMIN" : "member"}` +
        `${row.note ? `   (${row.note})` : ""}`,
    );
  }

  console.log(
    `\nTeams:       ${report.teams.created} created, ${report.teams.matched} matched\n` +
      `Accounts:    ${report.people.authCreated} created, ${report.people.authExisting} existed\n` +
      `Memberships: ${report.memberships.created} added, ${report.memberships.existing} already in place\n` +
      `Org admins:  ${report.orgAdmins.granted.length} granted, ${report.orgAdmins.unchanged.length} already admin\n` +
      `Writes:      ${report.writes}`,
  );

  if (report.orgAdmins.granted.length > 0) {
    console.log(
      `\nOrg admin ${apply ? "granted to" : "would be granted to"}: ${report.orgAdmins.granted.join(", ")}` +
        (apply
          ? "\n  They must sign out and back in — the claim rides on the session cookie."
          : ""),
    );
  }

  if (report.orgAdmins.notRevoked.length > 0) {
    console.log(
      `\nStill org admin though the file says member: ${report.orgAdmins.notRevoked.join(", ")}\n` +
        "  This import never revokes access. Remove it deliberately:\n" +
        "    pnpm admin:set-role --email <address> --role normal --apply",
    );
  }

  if (report.unrecognizedAccess.length > 0) {
    console.log(
      `\nUnrecognized Role access values (imported as member): ` +
        report.unrecognizedAccess.map((v) => `"${v}"`).join(", "),
    );
  }

  if (report.issues.length > 0) {
    console.log(`\nRows not imported (${report.issues.length}):`);
    for (const issue of report.issues) {
      const where = issue.line > 0 ? `row ${issue.line}` : "file";
      console.log(`  ${where} ${issue.label} — ${issue.reason}`);
    }
  }

  if (report.leaderless.length > 0) {
    console.log(
      `\nTeams with no leader: ${report.leaderless.join(", ")}\n` +
        "  Role access grants org admin, never team leadership.\n" +
        "  Promote a leader per team:  pnpm member:set-role --help",
    );
  }

  for (const entry of report.notInFile) {
    console.log(
      `\nOn "${entry.team}" here but not in the file: ${entry.names.join(", ")}\n` +
        "  This import never removes anyone — remove them on the team's Members tab if they have left.",
    );
  }

  if (!apply) {
    console.log("\nNothing was written. Re-run with --apply to commit.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
