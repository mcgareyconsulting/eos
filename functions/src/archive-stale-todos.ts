/**
 * Monday ~3:00 America/Chicago — archive pure to-dos / issues / discussed
 * headlines / done rocks closed before this week's Monday 00:00.
 *
 * Deploy: firebase deploy --only functions:archiveStaleTodos
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { firestoreDatabaseId } from "./config";
import {
  mondayMidnightMsInTimeZone,
  selectHeadlinesDiscussedBeforeWeek,
  selectIssuesClosedBeforeWeek,
  selectRocksDoneBeforeWeek,
  selectTodosCompletedBeforeWeek,
} from "./todos-archive";

const TIME_ZONE = "America/Chicago";
const BATCH_SIZE = 400;

function adminDb() {
  if (getApps().length === 0) initializeApp();
  const id = firestoreDatabaseId.value();
  return id ? getFirestore(id) : getFirestore();
}

async function archiveCollection(
  db: FirebaseFirestore.Firestore,
  collection: string,
  ids: string[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const id of chunk) {
      batch.update(db.collection(collection).doc(id), {
        archived_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

export async function runArchiveStaleTodos(now: Date = new Date()): Promise<{
  weekStartMs: number;
  scanned: {
    todos: number;
    issues: number;
    headlines: number;
    rocks: number;
  };
  archived: {
    todos: number;
    issues: number;
    headlines: number;
    rocks: number;
  };
}> {
  const db = adminDb();
  const weekStartMs = mondayMidnightMsInTimeZone(TIME_ZONE, now);

  // Scan only un-archived docs so the sweep doesn't re-read the forever-
  // growing archive. Every creation path (server actions, seed-demo,
  // import) should write an explicit `archived_at: null`, which this equality
  // filter requires — Firestore `== null` does NOT match docs missing the
  // field. Legacy rocks without `archived_at` need a one-time backfill to
  // `archived_at: null` before they are covered by the sweep.
  const [todosSnap, issuesSnap, headlinesSnap, rocksSnap] = await Promise.all([
    db.collection("todos").where("archived_at", "==", null).get(),
    db.collection("issues").where("archived_at", "==", null).get(),
    db.collection("headlines").where("archived_at", "==", null).get(),
    db.collection("rocks").where("archived_at", "==", null).get(),
  ]);

  const todoIds = selectTodosCompletedBeforeWeek(
    todosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    weekStartMs,
  );
  const issueIds = selectIssuesClosedBeforeWeek(
    issuesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    weekStartMs,
  );
  const headlineIds = selectHeadlinesDiscussedBeforeWeek(
    headlinesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    weekStartMs,
  );
  const rockIds = selectRocksDoneBeforeWeek(
    rocksSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    weekStartMs,
  );

  const [todos, issues, headlines, rocks] = await Promise.all([
    archiveCollection(db, "todos", todoIds),
    archiveCollection(db, "issues", issueIds),
    archiveCollection(db, "headlines", headlineIds),
    archiveCollection(db, "rocks", rockIds),
  ]);

  return {
    weekStartMs,
    scanned: {
      todos: todosSnap.size,
      issues: issuesSnap.size,
      headlines: headlinesSnap.size,
      rocks: rocksSnap.size,
    },
    archived: { todos, issues, headlines, rocks },
  };
}

export const archiveStaleTodos = onSchedule(
  {
    schedule: "0 3 * * 1",
    timeZone: TIME_ZONE,
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    const result = await runArchiveStaleTodos();
    console.log(
      JSON.stringify({
        msg: "archiveStaleTodos complete",
        timeZone: TIME_ZONE,
        weekStartIso: new Date(result.weekStartMs).toISOString(),
        scanned: result.scanned,
        archived: result.archived,
      }),
    );
  },
);
