// Mark (or unmark) a team as the leadership team.
//
// Members of a team flagged `is_leadership` get org-wide READ access to /data
// — every team's rocks, to-dos, issues, headlines and scorecard — without
// holding the admin claim (which also grants writes and team creation). See
// requireOrgReader() in lib/firebase/teams.ts.
//
// Usage:
//   pnpm team:set-leadership --list
//   pnpm team:set-leadership --team <teamId> --apply
//   pnpm team:set-leadership --team <teamId> --off --apply
//
// Dry-run by default (no --apply). Unlike the admin claim this is a Firestore
// field, not a token claim, so it takes effect on the member's next page load
// — no sign-out required.

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";

type Args = { teamId?: string; list: boolean; off: boolean; apply: boolean };

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
  return {
    teamId: str("team"),
    list: flags.has("list"),
    off: flags.has("off"),
    apply: flags.has("apply"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getAdminDb();

  const teamsSnap = await db.collection("teams").orderBy("name").get();

  if (args.list || !args.teamId) {
    console.log(`\n${teamsSnap.size} team(s):\n`);
    for (const t of teamsSnap.docs) {
      const flag = t.data()?.is_leadership === true ? "  ← leadership" : "";
      console.log(`  ${t.id}  ${String(t.data()?.name ?? "(unnamed)")}${flag}`);
    }
    if (!args.teamId) {
      console.log("\nPass --team <teamId> to set the flag (add --apply to write).");
    }
    return;
  }

  const teamRef = db.collection("teams").doc(args.teamId);
  const snap = await teamRef.get();
  if (!snap.exists) {
    console.error(`No team ${args.teamId}`);
    process.exit(1);
  }

  const name = String(snap.data()?.name ?? "(unnamed)");
  const was = snap.data()?.is_leadership === true;
  const next = !args.off;

  const membersSnap = await db
    .collection("team_members")
    .where("team_id", "==", args.teamId)
    .get();

  console.log(`Team:  ${name}  (${args.teamId})`);
  console.log(`Was:   is_leadership = ${was}`);
  console.log(`Next:  is_leadership = ${next}`);
  console.log(
    `\nThis ${next ? "grants" : "revokes"} org-wide /data read for ${membersSnap.size} member(s).`,
  );
  console.log(
    args.apply ? "\nApplying…" : "\nDry-run only. Re-run with --apply to write.",
  );

  if (!args.apply) return;

  // Only one team should hold the flag at a time in practice, but the reader
  // check accepts any of them — clear the others so the grant stays legible.
  if (next) {
    for (const t of teamsSnap.docs) {
      if (t.id !== args.teamId && t.data()?.is_leadership === true) {
        await t.ref.update({ is_leadership: false });
        console.log(`  cleared flag on ${String(t.data()?.name ?? t.id)}`);
      }
    }
  }
  await teamRef.update({ is_leadership: next });
  console.log("\n✓ Updated. Members see the change on their next page load.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
