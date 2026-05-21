// Seeds the Firebase project with demo data for the bank pitch.
// Usage:
//   pnpm seed <your-uid>
// Get your UID from Firebase Console → Authentication → Users (it's shown under your name).
//
// Idempotent: re-running clears existing rocks for the team and re-seeds.

import { config } from "dotenv";
config({ path: ".env.local" });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";

const DEMO_TEAM_NAME = "Executive Team";

const ROCKS = [
  {
    title: "Hit Q2 deposit growth target of $50M",
    status: "on_track",
    description: "Mass-market campaign + commercial outreach push.",
  },
  {
    title: "Launch consumer mobile app v2.0",
    status: "on_track",
    description:
      "iOS + Android, full account access, mobile check deposit, bill pay.",
  },
  {
    title: "Complete First National Bank acquisition integration",
    status: "off_track",
    description:
      "Customer migration, branch rebrand, core system consolidation.",
  },
  {
    title: "Reduce loan processing time from 14 → 7 days",
    status: "on_track",
    description: "Process redesign + automation in underwriting workflow.",
  },
  {
    title: "Achieve 95% scorecard adherence across teams",
    status: "done",
    description: "All teams hitting weekly KPI targets consistently.",
  },
  {
    title: "Open 3 new branch locations",
    status: "cancelled",
    description: "Deprioritized — capital redirected to digital investment.",
  },
];

function currentQuarter(): string {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

async function main() {
  const uid = process.argv[2];
  if (!uid) {
    console.error("Usage: pnpm seed <your-uid>");
    console.error(
      "Get your UID from the Firebase Console → Authentication → Users page (shown under your name).",
    );
    process.exit(1);
  }

  const db = getAdminDb();

  // Find or create the user's team
  const memberships = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .limit(1)
    .get();

  let teamId: string;
  if (memberships.empty) {
    console.log("No team found — creating Executive Team...");
    const ref = db.collection("teams").doc();
    await ref.set({
      name: DEMO_TEAM_NAME,
      org_id: "default",
      parent_team_id: null,
      created_at: FieldValue.serverTimestamp(),
    });
    await db
      .collection("team_members")
      .doc(`${ref.id}__${uid}`)
      .set({
        team_id: ref.id,
        user_id: uid,
        role: "leader",
        created_at: FieldValue.serverTimestamp(),
      });
    teamId = ref.id;
  } else {
    teamId = memberships.docs[0].data().team_id;
    // Rename to demo-friendly name
    await db.collection("teams").doc(teamId).update({ name: DEMO_TEAM_NAME });
    console.log(`Using existing team ${teamId} (renamed to ${DEMO_TEAM_NAME}).`);
  }

  // Clear existing rocks for clean re-seed
  const existing = await db
    .collection("rocks")
    .where("team_id", "==", teamId)
    .get();
  if (!existing.empty) {
    console.log(`Clearing ${existing.size} existing rocks…`);
    const batch = db.batch();
    existing.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // Add the demo rocks
  console.log(`Seeding ${ROCKS.length} rocks…`);
  const quarter = currentQuarter();
  const writeBatch = db.batch();
  for (const r of ROCKS) {
    writeBatch.set(db.collection("rocks").doc(), {
      team_id: teamId,
      title: r.title,
      description: r.description ?? null,
      status: r.status,
      quarter,
      owner_id: uid,
      due_date: null,
      created_at: FieldValue.serverTimestamp(),
    });
  }
  await writeBatch.commit();

  console.log(`✓ Done. Reload the Rocks page to see the seeded data.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
