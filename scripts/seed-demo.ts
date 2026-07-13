// Comprehensive demo seed for the EOS walkthrough.
//
// Fills EVERY screen for a believable High Plains Bank leadership team:
//   • 4 synthetic teammates (+ you, the leader)
//   • Rocks (with milestones) across all statuses + owners
//   • Scorecard — 7 metrics × 8 weeks of entries (green/red mix, a story)
//   • Issues — ranked by real seeded votes, mixed statuses
//   • To-Dos — open/done/private/overdue, assigned across the team
//   • Headlines — customer / employee / cascading
//   • One completed L10 meeting with peer effectiveness scores
//
// Usage:
//   pnpm seed <your-uid> ["Team Name"]
// Get your UID from Firebase Console → Authentication → Users.
//
// Idempotent: clears the team's existing EOS data first, then reseeds, so you
// can re-run it between demos for a clean slate. Does NOT touch other teams.

import { config } from "dotenv";
config({ path: ".env.local" });

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  Firestore,
  Query,
  DocumentData,
} from "firebase-admin/firestore";
import { getAdminDb, getAdminAuth } from "../lib/firebase/admin";
import { linkMeetingRecap } from "./link-meeting-recap";
import {
  lastNMondays,
  toDateString,
  currentQuarter,
  endOfQuarter,
  addDays,
} from "../lib/dates";

const DEFAULT_TEAM_NAME = "Demo Team";

// ---------------------------------------------------------------------------
// Synthetic teammates. Stable ids so re-runs upsert rather than duplicate.
// ---------------------------------------------------------------------------
type MemberKey = "me" | "sarah" | "marcus" | "elena" | "tom";

const SYNTHETIC_MEMBERS: {
  key: Exclude<MemberKey, "me">;
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}[] = [
  { key: "sarah", id: "demo-sarah-chen", first_name: "Sarah", last_name: "Chen", email: "sarah.chen@example.com" },
  { key: "marcus", id: "demo-marcus-reed", first_name: "Marcus", last_name: "Reed", email: "marcus.reed@example.com" },
  { key: "elena", id: "demo-elena-vasquez", first_name: "Elena", last_name: "Vasquez", email: "elena.vasquez@example.com" },
  { key: "tom", id: "demo-tom-bradley", first_name: "Tom", last_name: "Bradley", email: "tom.bradley@example.com" },
];

// ---------------------------------------------------------------------------
// Rocks (+ milestones). daysFromNow is relative to seed time.
// ---------------------------------------------------------------------------
type SeedRock = {
  title: string;
  description: string;
  status: "on_track" | "off_track" | "done" | "cancelled";
  owner: MemberKey;
  rock_type?: "company" | "department" | "individual";
  milestones?: { title: string; daysFromNow: number; done?: boolean }[];
};

const ROCKS: SeedRock[] = [
  {
    title: "Hit Q2 deposit growth target of $50M",
    description: "Mass-market campaign + commercial outreach push.",
    status: "on_track",
    owner: "marcus",
    rock_type: "company",
    milestones: [
      { title: "Launch deposit campaign creative", daysFromNow: -21, done: true },
      { title: "Commercial RM outreach to top 50 prospects", daysFromNow: 7 },
      { title: "Mid-quarter pipeline review", daysFromNow: 25 },
    ],
  },
  {
    rock_type: "department",
    title: "Launch consumer mobile app v2.0",
    description: "iOS + Android: full account access, mobile deposit, bill pay.",
    status: "on_track",
    owner: "sarah",
    milestones: [
      { title: "Feature freeze + QA handoff", daysFromNow: -10, done: true },
      { title: "App Store + Play Store submission", daysFromNow: 5 },
      { title: "Phased rollout to 10% of users", daysFromNow: 28 },
    ],
  },
  {
    title: "Complete First National Bank acquisition integration",
    description: "Customer migration, branch rebrand, core system consolidation.",
    status: "off_track",
    owner: "me",
    milestones: [
      { title: "Signed integration plan", daysFromNow: -30, done: true },
      { title: "Core system cutover dry-run", daysFromNow: 3 },
      { title: "Branch rebrand complete", daysFromNow: 40 },
    ],
  },
  {
    title: "Reduce loan processing time from 14 → 7 days",
    description: "Process redesign + automation in the underwriting workflow.",
    status: "on_track",
    owner: "tom",
    milestones: [
      { title: "Map current-state bottlenecks", daysFromNow: -14, done: true },
      { title: "Pilot automated doc intake", daysFromNow: 12 },
    ],
  },
  {
    title: "Achieve SOC 2 Type II certification",
    description: "Required for enterprise treasury management clients.",
    status: "on_track",
    owner: "elena",
    milestones: [
      { title: "Audit kickoff", daysFromNow: -7, done: true },
      { title: "Evidence collection complete", daysFromNow: 14 },
      { title: "Auditor report received", daysFromNow: 42 },
    ],
  },
  {
    title: "Achieve 95% scorecard adherence across all teams",
    description: "Every team hitting weekly KPI targets consistently.",
    status: "done",
    owner: "sarah",
  },
  {
    title: "Open 3 new branch locations",
    description: "Deprioritized — capital redirected to digital investment.",
    status: "cancelled",
    owner: "me",
  },
];

// ---------------------------------------------------------------------------
// Scorecard. `values` is oldest → newest (8 weeks); mapped onto Mondays below.
// Designed so averages show a green/red mix and the latest week has a couple
// of obvious red cells to point at during the demo.
// ---------------------------------------------------------------------------
type SeedMetric = {
  name: string;
  unit: "number" | "currency" | "percent" | "yesno" | "time";
  goal: number;
  direction: "gte" | "lte" | "eq";
  owner: MemberKey;
  group?: string; // ninety.io-style scorecard section
  values: number[]; // length 8, oldest → newest
};

const METRICS: SeedMetric[] = [
  {
    name: "New deposits ($/wk)",
    unit: "currency",
    goal: 1_200_000,
    direction: "gte",
    owner: "marcus",
    group: "Deposit & Loan Volume",
    values: [1_250_000, 1_310_000, 1_180_000, 1_420_000, 1_380_000, 1_270_000, 1_450_000, 1_090_000],
  },
  {
    name: "Loans funded ($/wk)",
    unit: "currency",
    goal: 2_000_000,
    direction: "gte",
    owner: "tom",
    group: "Deposit & Loan Volume",
    values: [2_100_000, 1_900_000, 2_300_000, 2_050_000, 2_200_000, 1_850_000, 2_400_000, 2_150_000],
  },
  {
    name: "Loan pipeline (#)",
    unit: "number",
    goal: 25,
    direction: "gte",
    owner: "tom",
    group: "Deposit & Loan Volume",
    values: [22, 26, 28, 24, 30, 27, 31, 33],
  },
  {
    name: "New checking accounts",
    unit: "number",
    goal: 40,
    direction: "gte",
    owner: "sarah",
    group: "Customer",
    values: [38, 45, 41, 52, 47, 39, 55, 48],
  },
  {
    name: "Net Promoter Score",
    unit: "number",
    goal: 50,
    direction: "gte",
    owner: "sarah",
    group: "Customer",
    values: [54, 57, 59, 61, 58, 62, 64, 66],
  },
  {
    name: "30-day delinquency rate",
    unit: "percent",
    goal: 1.5,
    direction: "lte",
    owner: "elena",
    group: "Risk & Compliance",
    values: [1.3, 1.5, 1.7, 1.9, 1.8, 2.1, 1.6, 1.4],
  },
  {
    name: "Open compliance findings",
    unit: "number",
    goal: 2,
    direction: "lte",
    owner: "elena",
    group: "Risk & Compliance",
    values: [3, 2, 4, 1, 2, 3, 1, 2],
  },
];

// ---------------------------------------------------------------------------
// Issues. Votes are derived from the seeded issue_votes below (kept in sync),
// so the Issues page ranks them correctly. The logged-in user casts none —
// leaving all 3 vote credits free to demo live during the L10 IDS segment.
// ---------------------------------------------------------------------------
type SeedIssue = {
  key: string;
  title: string;
  description: string | null;
  type: "short" | "long";
  status: "open" | "solving" | "solved" | "dropped";
  owner: MemberKey;
  priority?: "urgent" | "high" | "medium" | "low";
};

const ISSUES: SeedIssue[] = [
  { key: "core", title: "Core system cutover keeps slipping", description: "Third reschedule — vendor resourcing is the bottleneck.", type: "long", status: "open", owner: "me", priority: "high" },
  { key: "underwriting", title: "Underwriting backlog is spiking turnaround time", description: "Two RMs out; doc intake still manual.", type: "short", status: "solving", owner: "tom", priority: "urgent" },
  { key: "appstore", title: "Mobile app store rejection — compliance disclosures", description: null, type: "short", status: "open", owner: "sarah", priority: "medium" },
  { key: "staffing", title: "Branch staffing gaps in two markets", description: null, type: "short", status: "open", owner: "marcus", priority: "high" },
  { key: "billpay", title: "Should we sunset the legacy bill-pay product?", description: "Low usage, high maintenance cost.", type: "long", status: "open", owner: "me", priority: "low" },
  { key: "vendor", title: "Vendor SLA misses on card processing", description: "Resolved — escalation path agreed with vendor.", type: "short", status: "solved", owner: "elena" },
  { key: "kyc", title: "Duplicate KYC alerts overwhelming ops", description: "Dropped — fixed by the rules-engine patch.", type: "short", status: "dropped", owner: "elena" },
];

// Each synthetic teammate spends ≤3 vote credits (the real per-team cap).
// [issueKey, voterKey, count]
const VOTES: [string, Exclude<MemberKey, "me">, number][] = [
  ["core", "sarah", 2],
  ["appstore", "sarah", 1],
  ["underwriting", "marcus", 1],
  ["staffing", "marcus", 1],
  ["core", "marcus", 1],
  ["underwriting", "tom", 2],
  ["core", "tom", 1],
  ["underwriting", "elena", 1],
  ["vendor", "elena", 1],
  ["billpay", "elena", 1],
];

// ---------------------------------------------------------------------------
// Standalone To-Dos (not rock milestones).
// ---------------------------------------------------------------------------
type SeedTodo = {
  title: string;
  owner: MemberKey;
  daysFromNow: number | null;
  done?: boolean;
  visibility?: "team" | "private";
};

const TODOS: SeedTodo[] = [
  { title: "Send Q2 board deck draft to directors", owner: "me", daysFromNow: 3 },
  { title: "Finalize mobile app launch comms plan", owner: "sarah", daysFromNow: 5 },
  { title: "Review delinquency remediation plan", owner: "elena", daysFromNow: 2 },
  { title: "Approve underwriting overtime budget", owner: "marcus", daysFromNow: -1 }, // overdue
  { title: "Confirm SOC 2 evidence list with auditor", owner: "tom", daysFromNow: 6 },
  { title: "Prep 1:1 notes with branch managers", owner: "me", daysFromNow: 4, visibility: "private" },
  { title: "Post Q1 results to the all-staff channel", owner: "sarah", daysFromNow: -4, done: true },
];

// ---------------------------------------------------------------------------
// Headlines.
// ---------------------------------------------------------------------------
type SeedHeadline = {
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading";
  by: MemberKey;
  daysAgo: number;
};

const HEADLINES: SeedHeadline[] = [
  { title: "Closed our largest-ever treasury relationship ($14M)", body: "Regional manufacturer moving full operating + payroll.", kind: "customer", by: "sarah", daysAgo: 1 },
  { title: "NPS hit an all-time high of 66", body: "Up 12 points year over year.", kind: "customer", by: "sarah", daysAgo: 2 },
  { title: "Welcomed 3 new commercial RMs this month", body: null, kind: "employee", by: "marcus", daysAgo: 3 },
  { title: "Elena earned her CRCM compliance certification", body: null, kind: "employee", by: "me", daysAgo: 4 },
  { title: "Board approved the 2026 digital investment plan", body: "Cascading to all teams — branch managers, please brief your staff.", kind: "cascading", by: "me", daysAgo: 5 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function at(d: Date, h: number, m: number): Date {
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}

async function deleteAll(db: Firestore, query: Query<DocumentData>) {
  const snap = await query.get();
  if (snap.empty) return 0;
  // Chunk into batches of 500 (Firestore limit).
  for (let i = 0; i < snap.docs.length; i += 500) {
    const batch = db.batch();
    snap.docs.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return snap.size;
}

async function clearTeamData(db: Firestore, teamId: string) {
  // Scorecard entries have no team_id — find them via the team's metrics first.
  const metricsSnap = await db
    .collection("scorecard_metrics")
    .where("team_id", "==", teamId)
    .get();
  for (const metric of metricsSnap.docs) {
    await deleteAll(
      db,
      db.collection("scorecard_entries").where("metric_id", "==", metric.id),
    );
  }

  // Meetings: delete each meeting's effectiveness_scores subcollection too.
  const meetingsSnap = await db
    .collection("meetings")
    .where("team_id", "==", teamId)
    .get();
  for (const meeting of meetingsSnap.docs) {
    await deleteAll(db, meeting.ref.collection("effectiveness_scores"));
    await deleteAll(db, meeting.ref.collection("presence"));
  }

  const byTeam = (col: string) =>
    db.collection(col).where("team_id", "==", teamId);

  let total = 0;
  for (const col of [
    "rocks",
    "rock_status_updates",
    "todos",
    "issues",
    "issue_votes",
    "scorecard_metrics",
    "headlines",
    "meetings",
  ]) {
    total += await deleteAll(db, byTeam(col));
  }
  return total;
}

// ---------------------------------------------------------------------------
async function main() {
  const account = process.argv[2];
  const teamName = process.argv[3] || DEFAULT_TEAM_NAME;
  if (!account) {
    console.error('Usage: pnpm seed <your-email-or-uid> ["Team Name"]');
    console.error(
      "Pass the EMAIL or UID of the account you sign in to the app with —",
    );
    console.error("using your login email avoids seeding under the wrong uid.");
    process.exit(1);
  }

  const db = getAdminDb();
  const auth = getAdminAuth();

  // Resolve the account → uid. Accept an email (looked up via Firebase Auth)
  // or a raw uid. Seeding by login email prevents the classic mistake of
  // attaching the data to a different uid than the one you actually sign in as.
  let uid = account;
  let authUser: import("firebase-admin/auth").UserRecord | null = null;
  try {
    authUser = account.includes("@")
      ? await auth.getUserByEmail(account)
      : await auth.getUser(account);
    uid = authUser.uid;
  } catch {
    if (account.includes("@")) {
      console.error(
        `No Firebase Auth user with email "${account}". Sign in to the app once, then re-run.`,
      );
      process.exit(1);
    }
    // A raw uid we couldn't look up — proceed with it as given.
  }
  console.log(`Account: ${authUser?.email ?? uid} (uid ${uid})`);

  const ownerByKey: Record<MemberKey, string> = {
    me: uid,
    sarah: "demo-sarah-chen",
    marcus: "demo-marcus-reed",
    elena: "demo-elena-vasquez",
    tom: "demo-tom-bradley",
  };

  // --- Find or create the team BY NAME -----------------------------------
  // Resolve by name (not "a team this uid is already on") so re-runs never
  // create a duplicate, and the account above is always attached to THIS team.
  const named = await db
    .collection("teams")
    .where("name", "==", teamName)
    .get();

  let teamId: string;
  if (named.empty) {
    console.log(`Creating team "${teamName}"…`);
    const ref = db.collection("teams").doc();
    await ref.set({
      name: teamName,
      org_id: "default",
      parent_team_id: null,
      created_at: FieldValue.serverTimestamp(),
    });
    teamId = ref.id;
  } else {
    teamId = named.docs[0].id;
    if (named.size > 1) {
      console.warn(
        `⚠ ${named.size} teams named "${teamName}" (${named.docs
          .map((d) => d.id)
          .join(", ")}). Seeding the first — delete the extras to avoid confusion.`,
      );
    }
    console.log(`Using existing team "${teamName}" (${teamId}).`);
  }

  // --- Ensure the account is a leader on this team (idempotent) ----------
  // This is the fix for "I can't see the seed data": no matter how the team
  // was created, the account you pass ends up a member of it.
  await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .set(
      {
        team_id: teamId,
        user_id: uid,
        role: "leader",
        created_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  // --- Make sure the leader's /users doc has a display name --------------
  await db.collection("users").doc(uid).set(
    {
      display_name: authUser?.displayName ?? authUser?.email ?? "Team Lead",
      email: authUser?.email ?? null,
      picture: authUser?.photoURL ?? null,
    },
    { merge: true },
  );

  // --- Upsert synthetic teammates ----------------------------------------
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

  // --- Clear prior demo data (idempotent re-seed) ------------------------
  const cleared = await clearTeamData(db, teamId);
  console.log(`Cleared ${cleared} existing docs for a clean slate.`);

  const quarter = currentQuarter();
  const eoq = toDateString(endOfQuarter());
  const now = new Date();

  // --- Rocks (+ milestones) ----------------------------------------------
  console.log(`Seeding ${ROCKS.length} rocks…`);
  for (const r of ROCKS) {
    const ownerId = ownerByKey[r.owner];
    const active = r.status === "on_track" || r.status === "off_track";
    const rockRef = db.collection("rocks").doc();
    await rockRef.set({
      team_id: teamId,
      title: r.title,
      description: r.description,
      status: r.status,
      rock_type: r.rock_type ?? "individual",
      quarter,
      owner_id: ownerId,
      due_date: active ? eoq : null,
      created_at: FieldValue.serverTimestamp(),
    });
    if (r.milestones?.length) {
      const batch = db.batch();
      for (const ms of r.milestones) {
        batch.set(db.collection("todos").doc(), {
          team_id: teamId,
          title: ms.title,
          owner_id: ownerId,
          due_date: toDateString(addDays(now, ms.daysFromNow)),
          completed_at: ms.done ? FieldValue.serverTimestamp() : null,
          visibility: "team",
          source_issue_id: null,
          source_meeting_id: null,
          source_rock_id: rockRef.id,
          created_at: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  // --- Scorecard (metrics + 8 weeks of entries) --------------------------
  console.log(`Seeding ${METRICS.length} scorecard metrics × 8 weeks…`);
  const weeks = lastNMondays(8).map(toDateString); // newest first
  for (const [i, mt] of METRICS.entries()) {
    const metricRef = db.collection("scorecard_metrics").doc();
    await metricRef.set({
      team_id: teamId,
      name: mt.name,
      unit: mt.unit,
      goal: mt.goal,
      direction: mt.direction,
      owner_id: ownerByKey[mt.owner],
      group: mt.group ?? null,
      sort_order: i,
      created_at: FieldValue.serverTimestamp(),
    });
    const batch = db.batch();
    weeks.forEach((week, wi) => {
      // weeks[0] is newest; values[] is oldest → newest.
      const value = mt.values[mt.values.length - 1 - wi];
      batch.set(
        db.collection("scorecard_entries").doc(`${metricRef.id}__${week}`),
        {
          metric_id: metricRef.id,
          week_start_date: week,
          value,
          note: null,
          created_at: FieldValue.serverTimestamp(),
        },
      );
    });
    await batch.commit();
  }

  // --- Issues (+ votes) ---------------------------------------------------
  console.log(`Seeding ${ISSUES.length} issues…`);
  const voteTotals = new Map<string, number>();
  for (const [issueKey, , count] of VOTES) {
    voteTotals.set(issueKey, (voteTotals.get(issueKey) ?? 0) + count);
  }
  const issueIdByKey = new Map<string, string>();
  for (const iss of ISSUES) {
    const ref = db.collection("issues").doc();
    issueIdByKey.set(iss.key, ref.id);
    const resolved = iss.status === "solved" || iss.status === "dropped";
    await ref.set({
      team_id: teamId,
      title: iss.title,
      description: iss.description,
      owner_id: ownerByKey[iss.owner],
      votes: voteTotals.get(iss.key) ?? 0,
      type: iss.type,
      priority: iss.priority ?? null,
      status: iss.status,
      resolved_at: resolved ? FieldValue.serverTimestamp() : null,
      resolution_todo_id: null,
      created_at: FieldValue.serverTimestamp(),
    });
  }
  const voteBatch = db.batch();
  for (const [issueKey, voterKey, count] of VOTES) {
    const issueId = issueIdByKey.get(issueKey);
    if (!issueId) continue;
    const voterId = ownerByKey[voterKey];
    voteBatch.set(db.collection("issue_votes").doc(`${issueId}__${voterId}`), {
      issue_id: issueId,
      user_id: voterId,
      team_id: teamId,
      count,
      created_at: FieldValue.serverTimestamp(),
    });
  }
  await voteBatch.commit();

  // --- Standalone To-Dos --------------------------------------------------
  console.log(`Seeding ${TODOS.length} to-dos…`);
  const todoBatch = db.batch();
  for (const t of TODOS) {
    todoBatch.set(db.collection("todos").doc(), {
      team_id: teamId,
      title: t.title,
      owner_id: ownerByKey[t.owner],
      due_date: t.daysFromNow == null ? null : toDateString(addDays(now, t.daysFromNow)),
      completed_at: t.done ? FieldValue.serverTimestamp() : null,
      visibility: t.visibility ?? "team",
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: null,
      created_at: FieldValue.serverTimestamp(),
    });
  }
  await todoBatch.commit();

  // --- Headlines ----------------------------------------------------------
  console.log(`Seeding ${HEADLINES.length} headlines…`);
  const headlineBatch = db.batch();
  for (const h of HEADLINES) {
    headlineBatch.set(db.collection("headlines").doc(), {
      team_id: teamId,
      title: h.title,
      body: h.body,
      kind: h.kind,
      created_by: ownerByKey[h.by],
      target_team_ids: [],
      created_at: Timestamp.fromDate(addDays(now, -h.daysAgo)),
    });
  }
  await headlineBatch.commit();

  // --- One completed L10 meeting (with per-attendee meeting ratings) ------
  console.log("Seeding one completed L10 meeting…");
  const lastWeek = addDays(now, -7);
  const startedAt = Timestamp.fromDate(at(lastWeek, 9, 0));
  const endedAt = Timestamp.fromDate(at(lastWeek, 10, 22));
  const meetingRef = db.collection("meetings").doc();
  await meetingRef.set({
    team_id: teamId,
    started_at: startedAt,
    ended_at: endedAt,
    current_segment: "done",
    segment_started_at: endedAt,
    current_issue_id: null,
    notes:
      "Solved the card-processing vendor SLA issue (escalation path agreed). " +
      "Underwriting backlog moved to solving — Tom piloting automated doc intake. " +
      "Acquisition integration flagged off-track; cutover dry-run rescheduled.",
    absent_user_ids: [],
  });
  // One rating doc per attendee, keyed by the rater's uid — each person
  // rates THE MEETING 1-10 (ROADMAP item 9), not their teammates.
  const allMemberIds = [uid, ...SYNTHETIC_MEMBERS.map((m) => m.id)];
  const SCORE_CYCLE = [8, 9, 7, 9, 8, 8, 9, 7];
  let s = 0;
  const scoreBatch = db.batch();
  for (const rater of allMemberIds) {
    scoreBatch.set(meetingRef.collection("effectiveness_scores").doc(rater), {
      user_id: rater,
      rating: SCORE_CYCLE[s++ % SCORE_CYCLE.length],
      notes: null,
      created_at: endedAt,
    });
  }
  await scoreBatch.commit();

  // Tie a subset of items into the meeting's window (+ link to-dos to it) so the
  // post-meeting recap shows Rocks/To-Dos created and Issues solved.
  await linkMeetingRecap(db, teamId, meetingRef.id);

  console.log("\n✓ Demo seed complete. Every screen now has data.");
  console.log(`  Team: "${teamName}" (${teamId})`);
  console.log("  Reload the app to see Rocks, Scorecard, Issues, To-Dos,");
  console.log("  Headlines, and a completed meeting populated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
