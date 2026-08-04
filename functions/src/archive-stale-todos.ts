/**
 * Monday ~3:00 America/Chicago — archive pure to-dos / issues / discussed
 * headlines closed before this week's Monday 00:00.
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
  scanned: { todos: number; issues: number; headlines: number };
  archived: { todos: number; issues: number; headlines: number };
}> {
  const db = adminDb();
  const weekStartMs = mondayMidnightMsInTimeZone(TIME_ZONE, now);

  // Scan only un-archived docs so the sweep doesn't re-read the forever-
  // growing archive. Every creation path (server actions, seed-demo,
  // import-csv) writes an explicit `archived_at: null`, which this equality
  // filter requires — Firestore `== null` does NOT match docs missing the
  // field. CAVEAT: docs imported by scripts/import-csv.ts before 2026-08-04
  // (the archive model / PR #17) lack the field entirely, so this query
  // skips them; if any such legacy docs are still un-archived, a one-time
  // backfill (set `archived_at: null` where missing) is needed to bring
  // them under sweep coverage.
  const [todosSnap, issuesSnap, headlinesSnap] = await Promise.all([
    db.collection("todos").where("archived_at", "==", null).get(),
    db.collection("issues").where("archived_at", "==", null).get(),
    db.collection("headlines").where("archived_at", "==", null).get(),
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

  const [todos, issues, headlines] = await Promise.all([
    archiveCollection(db, "todos", todoIds),
    archiveCollection(db, "issues", issueIds),
    archiveCollection(db, "headlines", headlineIds),
  ]);

  return {
    weekStartMs,
    scanned: {
      todos: todosSnap.size,
      issues: issuesSnap.size,
      headlines: headlinesSnap.size,
    },
    archived: { todos, issues, headlines },
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
