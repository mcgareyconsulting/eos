// Read-only diagnostic: lists every team, its members, and how much EOS data
// each holds. Optionally resolves an email to show which teams that account is
// on. Touches nothing — safe to run anytime.
//
// Usage:
//   pnpm tsx scripts/team-info.ts [your-login-email]

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb, getAdminAuth } from "../lib/firebase/admin";

const DATA_COLLECTIONS = [
  "rocks",
  "issues",
  "todos",
  "scorecard_metrics",
  "headlines",
  "meetings",
] as const;

async function main() {
  const email = process.argv[2];
  const db = getAdminDb();
  const auth = getAdminAuth();

  const teamsSnap = await db.collection("teams").get();
  console.log(`\n${teamsSnap.size} team(s) in the project:\n`);

  for (const t of teamsSnap.docs) {
    const name = (t.data().name as string) ?? "(unnamed)";
    const membersSnap = await db
      .collection("team_members")
      .where("team_id", "==", t.id)
      .get();
    const memberIds = membersSnap.docs.map((d) => d.data().user_id as string);
    const real = memberIds.filter((id) => !id.startsWith("demo-"));
    const synthetic = memberIds.filter((id) => id.startsWith("demo-"));

    const counts: Record<string, number> = {};
    for (const col of DATA_COLLECTIONS) {
      counts[col] = (
        await db.collection(col).where("team_id", "==", t.id).get()
      ).size;
    }

    console.log(`• "${name}"  (${t.id})`);
    console.log(
      `    members: ${memberIds.length}  (real: ${real.join(", ") || "—"}; synthetic: ${synthetic.length})`,
    );
    console.log(
      `    data: ${DATA_COLLECTIONS.map((c) => `${c}=${counts[c]}`).join("  ")}`,
    );
  }

  if (email) {
    try {
      const u = await auth.getUserByEmail(email);
      const mine = await db
        .collection("team_members")
        .where("user_id", "==", u.uid)
        .get();
      console.log(
        `\n${email} (uid ${u.uid}) is a member of ${mine.size} team(s): ${mine.docs
          .map((d) => d.data().team_id)
          .join(", ")}`,
      );
    } catch (e) {
      console.log(`\nCould not resolve "${email}": ${(e as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
