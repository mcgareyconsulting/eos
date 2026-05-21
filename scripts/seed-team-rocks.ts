// Adds synthetic team members + a handful of team rocks so the "Team Rocks"
// section, owner filter, milestone disclosure, and status colors all have
// something to render. Additive — does NOT clear existing data.
//
// Usage:
//   pnpm tsx scripts/seed-team-rocks.ts <your-uid>
//
// Get your UID from Firebase Console → Authentication → Users.

import { config } from "dotenv";
config({ path: ".env.local" });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";

const SYNTHETIC_MEMBERS = [
  {
    id: "demo-sarah-chen",
    first_name: "Sarah",
    last_name: "Chen",
    email: "sarah.chen@example.com",
  },
  {
    id: "demo-marcus-reed",
    first_name: "Marcus",
    last_name: "Reed",
    email: "marcus.reed@example.com",
  },
  {
    id: "demo-elena-vasquez",
    first_name: "Elena",
    last_name: "Vasquez",
    email: "elena.vasquez@example.com",
  },
];

type SeedRock = {
  title: string;
  description: string;
  status: "on_track" | "off_track" | "done" | "cancelled";
  ownerKey: "me" | "sarah" | "marcus" | "elena";
  milestones?: { title: string; daysFromNow: number; done?: boolean }[];
};

const TEAM_ROCKS: SeedRock[] = [
  {
    title: "Roll out new commercial lending platform",
    description: "Replace legacy origination system; train RMs by end of Q2.",
    status: "on_track",
    ownerKey: "sarah",
    milestones: [
      { title: "Vendor contract signed", daysFromNow: -30, done: true },
      { title: "Pilot with 3 RMs", daysFromNow: 7 },
      { title: "All RMs trained", daysFromNow: 35 },
    ],
  },
  {
    title: "Reduce branch operating costs by 12%",
    description: "Lease renegotiations + shared services consolidation.",
    status: "off_track",
    ownerKey: "marcus",
    milestones: [
      { title: "Cost benchmark report", daysFromNow: -14, done: true },
      { title: "Renegotiate 5 high-cost leases", daysFromNow: 21 },
    ],
  },
  {
    title: "Achieve SOC 2 Type II certification",
    description: "Required for enterprise treasury management clients.",
    status: "on_track",
    ownerKey: "elena",
    milestones: [
      { title: "Audit kickoff", daysFromNow: -7, done: true },
      { title: "Evidence collection complete", daysFromNow: 14 },
      { title: "Auditor report received", daysFromNow: 42 },
    ],
  },
  {
    title: "Launch private banking division",
    description: "Target HNW clients in metro market; hire 3 advisors.",
    status: "on_track",
    ownerKey: "sarah",
  },
  {
    title: "Sunset paper statement program",
    description: "Move final 8% of customers to digital. Print savings ~$240K/yr.",
    status: "done",
    ownerKey: "me",
  },
];

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfQuarter(d: Date = new Date()): Date {
  const q = Math.floor(d.getMonth() / 3);
  const lastMonth = q * 3 + 2;
  const out = new Date(d.getFullYear(), lastMonth + 1, 0);
  out.setHours(0, 0, 0, 0);
  return out;
}

function currentQuarter(): string {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

async function main() {
  const uid = process.argv[2];
  if (!uid) {
    console.error("Usage: pnpm tsx scripts/seed-team-rocks.ts <your-uid>");
    process.exit(1);
  }

  const db = getAdminDb();

  // Find the user's team.
  const memberships = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .limit(1)
    .get();
  if (memberships.empty) {
    console.error(
      "No team found for that UID. Run `pnpm seed <uid>` first to create a team.",
    );
    process.exit(1);
  }
  const teamId = memberships.docs[0].data().team_id as string;
  console.log(`Using team ${teamId}.`);

  // Idempotently create synthetic team members + their /users docs.
  console.log(`Adding ${SYNTHETIC_MEMBERS.length} synthetic teammates…`);
  const memberBatch = db.batch();
  for (const m of SYNTHETIC_MEMBERS) {
    memberBatch.set(
      db.collection("users").doc(m.id),
      {
        first_name: m.first_name,
        last_name: m.last_name,
        email: m.email,
        display_name: `${m.first_name} ${m.last_name}`,
      },
      { merge: true },
    );
    memberBatch.set(
      db.collection("team_members").doc(`${teamId}__${m.id}`),
      {
        team_id: teamId,
        user_id: m.id,
        role: "member",
        created_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await memberBatch.commit();

  // Map ownerKey → uid for the rocks.
  const ownerByKey: Record<SeedRock["ownerKey"], string> = {
    me: uid,
    sarah: "demo-sarah-chen",
    marcus: "demo-marcus-reed",
    elena: "demo-elena-vasquez",
  };

  const quarter = currentQuarter();
  const eoqStr = toDateString(endOfQuarter());
  const today = new Date();

  console.log(`Seeding ${TEAM_ROCKS.length} rocks…`);
  for (const r of TEAM_ROCKS) {
    const rockRef = db.collection("rocks").doc();
    const ownerId = ownerByKey[r.ownerKey];
    await rockRef.set({
      team_id: teamId,
      title: r.title,
      description: r.description,
      status: r.status,
      quarter,
      owner_id: ownerId,
      due_date: eoqStr,
      created_at: FieldValue.serverTimestamp(),
    });

    if (r.milestones?.length) {
      const msBatch = db.batch();
      for (const ms of r.milestones) {
        msBatch.set(db.collection("todos").doc(), {
          team_id: teamId,
          title: ms.title,
          owner_id: ownerId,
          due_date: toDateString(addDays(today, ms.daysFromNow)),
          completed_at: ms.done ? FieldValue.serverTimestamp() : null,
          visibility: "team",
          source_issue_id: null,
          source_meeting_id: null,
          source_rock_id: rockRef.id,
          created_at: FieldValue.serverTimestamp(),
        });
      }
      await msBatch.commit();
    }
  }

  console.log(`✓ Done. Reload the Rocks page.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
