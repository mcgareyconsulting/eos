/**
 * Sunday 03:00 America/Chicago — export the production Firestore database
 * to the long-term archive bucket under a DATED prefix:
 *
 *   gs://<ARCHIVE_BUCKET>/firestore/<YYYY-MM-DD>T<HHMMSS>Z/...
 *
 * WHY A FUNCTION AND NOT A CLOUD SCHEDULER HTTP JOB: Firestore always writes
 * the same file names (`output-0`, `output-1`, ...) under whatever prefix it
 * is given, and a Scheduler job's request body is a fixed string — it cannot
 * insert today's date. With a fixed prefix the second weekly export tries to
 * overwrite the first, and the archive bucket's 7-year retention policy
 * refuses (confirmed 2026-09-27 after the first run). Building the prefix at
 * run time gives one immutable, dated folder per week — which is also what
 * an archive should look like. This is Google's documented pattern for
 * scheduled exports (firebase.google.com/docs/firestore/solutions/schedule-export).
 *
 * IDENTITY: runs as `eos-backup@<project>.iam.gserviceaccount.com`, the one
 * service account holding `roles/datastore.importExportAdmin` (Editor does
 * not include the export permission). The export files themselves are
 * written by Firestore's own service agent, which has objectAdmin on the
 * bucket (terraform/backup.tf).
 *
 * The function waits for the export operation to finish (typically seconds
 * for this database) and throws if it fails, so a failure is a Cloud
 * Functions error in the logs. The "Firestore export (backup) failed" alert
 * policy (terraform/monitoring.tf) matches the ExportDocuments audit-log
 * entry regardless of who called it.
 *
 * Deploy: firebase deploy --only functions:exportFirestore
 * Run now: Cloud Scheduler → firebase-schedule-exportFirestore-us-east1 → Force run
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { archiveBucketName, firestoreDatabaseId } from "./config";

const TIME_ZONE = "America/Chicago";
const REGION = "us-east1";
const BACKUP_SERVICE_ACCOUNT = "eos-backup@hpb-eos-prod.iam.gserviceaccount.com";
const FIRESTORE_ADMIN = "https://firestore.googleapis.com/v1";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 8 * 60 * 1_000; // under the 540s function timeout

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error("exportFirestore: project id not available in the runtime environment");
  return id;
}

async function accessToken(): Promise<string> {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault() });
  const token = await applicationDefault().getAccessToken();
  return token.access_token;
}

/** `2026-09-27T160019Z` — sortable, second-granular so two runs never share
 * a folder, no characters that need escaping in a GCS path. */
function stampFor(now: Date): string {
  const iso = now.toISOString(); // 2026-09-27T16:00:19.661Z
  return `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

interface Operation {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  metadata?: { operationState?: string; outputUriPrefix?: string };
}

async function firestoreAdmin(path: string, init: RequestInit): Promise<Operation> {
  const res = await fetch(`${FIRESTORE_ADMIN}/${path}`, init);
  const body = (await res.json()) as Operation & { error?: { message: string } };
  if (!res.ok) {
    throw new Error(`Firestore Admin ${path} → HTTP ${res.status}: ${body.error?.message ?? "unknown error"}`);
  }
  return body;
}

export async function runExportFirestore(now = new Date()): Promise<{ prefix: string; operation: string }> {
  const bucket = archiveBucketName.value();
  const database = firestoreDatabaseId.value();
  if (!bucket) throw new Error("exportFirestore: ARCHIVE_BUCKET is not set");
  if (!database) throw new Error("exportFirestore: FIRESTORE_DATABASE_ID is not set");

  const prefix = `gs://${bucket}/firestore/${stampFor(now)}`;
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const name = `projects/${projectId()}/databases/${database}`;

  const started = await firestoreAdmin(`${name}:exportDocuments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ outputUriPrefix: prefix }),
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let op = started;
  while (!op.done) {
    if (Date.now() > deadline) {
      throw new Error(`exportFirestore: operation ${op.name} still running after ${POLL_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    op = await firestoreAdmin(op.name, { method: "GET", headers });
  }
  if (op.error) {
    throw new Error(`exportFirestore: operation ${op.name} failed (${op.error.code}): ${op.error.message}`);
  }

  console.log(
    JSON.stringify({
      event: "firestore_export_complete",
      database,
      prefix,
      operation: op.name,
      state: op.metadata?.operationState ?? "SUCCESSFUL",
    }),
  );
  return { prefix, operation: op.name };
}

export const exportFirestore = onSchedule(
  {
    schedule: "0 3 * * 0",
    timeZone: TIME_ZONE,
    region: REGION,
    serviceAccount: BACKUP_SERVICE_ACCOUNT,
    memory: "256MiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async () => {
    await runExportFirestore();
  },
);
