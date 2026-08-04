// Ties a few existing items to a completed meeting so its recap isn't empty.
//
// The recap counts items whose created_at falls inside the meeting's
// [started_at, ended_at] window (and issues whose resolved_at is in-window).
// This stamps a small, believable subset into that window and links the to-dos
// to the meeting via source_meeting_id.
//
// Reused by the seed (imported), and runnable standalone against live data:
//   pnpm tsx scripts/link-meeting-recap.ts ["Team Name"]   (default "Demo Team")

import { config } from "dotenv";
config({ path: ".env.local" });

import { Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";

export async function linkMeetingRecap(
  db: Firestore,
  teamId: string,
  meetingId: string,
): Promise<{ rocks: number; todos: number; solved: number; raised: number }> {
  const meeting = await db.collection("meetings").doc(meetingId).get();
  const data = meeting.data();
  if (!data?.started_at || !data?.ended_at) {
    return { rocks: 0, todos: 0, solved: 0, raised: 0 };
  }
  const startedMs = data.started_at.toMillis() as number;
  const endedMs = data.ended_at.toMillis() as number;
  // A timestamp at fraction `f` through the meeting (0 = start, 1 = end).
  const inWindow = (f: number) =>
    Timestamp.fromMillis(Math.round(startedMs + (endedMs - startedMs) * f));

  // 2 rocks "created" during the meeting.
  const rocks = (
    await db.collection("rocks").where("team_id", "==", teamId).get()
  ).docs;
  for (const r of rocks.slice(0, 2)) {
    await r.ref.update({ created_at: inWindow(0.2) });
  }

  // 3 standalone, still-open to-dos created during + tied to the meeting.
  const todos = (
    await db.collection("todos").where("team_id", "==", teamId).get()
  ).docs.filter((d) => !d.data().source_rock_id && !d.data().completed_at);
  for (const t of todos.slice(0, 3)) {
    await t.ref.update({
      created_at: inWindow(0.5),
      source_meeting_id: meetingId,
    });
  }

  // Solve 1 issue during the meeting (prefer one already solved so we don't
  // shrink the live Issues list), and raise 1 during it.
  const issues = (
    await db.collection("issues").where("team_id", "==", teamId).get()
  ).docs;
  const solveTarget =
    issues.find((d) => d.data().status === "solved") ??
    issues.find((d) => d.data().status === "open");
  if (solveTarget) {
    await solveTarget.ref.update({
      status: "solved",
      resolved_at: inWindow(0.7),
    });
  }
  const raised = issues.find((d) => d.id !== solveTarget?.id);
  if (raised) {
    await raised.ref.update({ created_at: inWindow(0.3) });
  }

  return {
    rocks: Math.min(2, rocks.length),
    todos: Math.min(3, todos.length),
    solved: solveTarget ? 1 : 0,
    raised: raised ? 1 : 0,
  };
}

async function main() {
  const teamName = process.argv[2] || "Demo Team";
  const db = getAdminDb();

  const teams = await db
    .collection("teams")
    .where("name", "==", teamName)
    .get();
  if (teams.empty) {
    console.error(`No team named "${teamName}".`);
    process.exit(1);
  }
  const teamId = teams.docs[0].id;

  const completed = (
    await db.collection("meetings").where("team_id", "==", teamId).get()
  ).docs
    .filter((d) => d.data().ended_at)
    .sort(
      (a, b) =>
        (b.data().started_at?.toMillis?.() ?? 0) -
        (a.data().started_at?.toMillis?.() ?? 0),
    );
  if (!completed.length) {
    console.error(`No completed meeting on "${teamName}".`);
    process.exit(1);
  }

  const res = await linkMeetingRecap(db, teamId, completed[0].id);
  console.log(
    `Linked to meeting ${completed[0].id} on "${teamName}": ${res.rocks} rocks, ${res.todos} to-dos, ${res.solved} solved issue, ${res.raised} raised issue.`,
  );
}

// Run main() only when invoked directly (not when imported by the seed).
if (process.argv[1]?.endsWith("link-meeting-recap.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
