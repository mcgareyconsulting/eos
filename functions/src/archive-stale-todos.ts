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
} from "../../lib/todos-archive";
import { autoArchiveActivity } from "../../lib/activity";

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

/**
 * To-dos also get an activity row per archive, in the same batch, so the
 * to-do's trace says the Monday sweep closed it out (lib/activity.ts).
 * Two writes per to-do, so half the chunk size.
 */
async function archiveTodos(
  db: FirebaseFirestore.Firestore,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  ids: Set<string>,
): Promise<number> {
  const due = docs.filter((d) => ids.has(d.id));
  const chunkSize = BATCH_SIZE / 2;
  for (let i = 0; i < due.length; i += chunkSize) {
    const batch = db.batch();
    for (const d of due.slice(i, i + chunkSize)) {
      const data = d.data();
      batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
      if (typeof data.team_id === "string" && data.team_id) {
        batch.set(
          db.collection("entity_activity").doc(),
          autoArchiveActivity(
            { ...data, id: d.id, team_id: data.team_id },
            "monday",
            FieldValue.serverTimestamp(),
          ),
        );
      }
    }
    await batch.commit();
  }
  return due.length;
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
  // growing archive. Every creation path (server actions, CSV import) should
  // write an explicit `archived_at: null`, which this equality
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
    archiveTodos(db, todosSnap.docs, new Set(todoIds)),
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
