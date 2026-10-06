/**
 * Daily ~6:00 America/Chicago — check that the three scheduled backups
 * (Firestore managed backups, the weekly Firestore export, the weekly
 * Firebase Auth export) are actually landing, and log one structured
 * heartbeat line either way.
 *
 * WHY THIS EXISTS: Cloud Scheduler silently skipped the 2026-09-28 Sunday
 * runs of `exportFirestore` / `exportAuthUsers` — no error, no alert, just
 * no export that week. A failure alert on those functions only fires when
 * they *run* and throw; it says nothing when the scheduler never invokes
 * them at all. Monitoring's `condition_absent` (metric-absence) alerting
 * caps its window at 23.5 hours, so it can't watch a weekly job directly —
 * but it can watch a *daily* heartbeat. This function is that heartbeat: it
 * runs every day, independently of the weekly export schedules, and reads
 * (never writes) the state those exports left behind. Silence from this
 * function for 23.5h is itself the alert condition.
 *
 * WHAT IT CHECKS (all read-only):
 *   1. Firestore managed backups — GET .../locations/us-east1/backups,
 *      newest `snapshotTime` for the prod database. Stale if >2 days old
 *      (daily backup schedule + slack).
 *   2. Firestore export — newest dated `firestore/<stamp>/` folder in the
 *      archive bucket (the undated legacy `firestore/all_namespaces/`
 *      folder is ignored; see export-firestore.ts). Stale if >8 days old
 *      (weekly schedule + slack).
 *   3. Auth export — newest `auth/<stamp>-users.json` object in the archive
 *      bucket (see export-auth-users.ts). Stale if >8 days old.
 *
 * IAM: runs as `eos-backup@<project>.iam.gserviceaccount.com`, the same
 * service account the export functions use, but granted only READ roles
 * for this job: `roles/datastore.backupsViewer` (project-level) and
 * `roles/storage.objectViewer` on the archive bucket (terraform/backup.tf,
 * "Backup freshness checker identity"). It never needs export or write
 * permissions.
 *
 * ALERTING: terraform/monitoring.tf turns the `backup_freshness` log line
 * into two alert policies —
 *   - "Backup freshness check failed": a `condition_matched_log` on
 *     `jsonPayload.event="backup_freshness" AND jsonPayload.ok=false`.
 *   - "Backup freshness check did not run": a `condition_absent` on the
 *     `eos_backup_freshness_heartbeat` log-based metric (derived from the
 *     same line), tripped after 23.5h of silence.
 * Both depend on this function logging exactly one `backup_freshness` line
 * per run, at console.log when healthy and additionally at console.error
 * (so it also becomes a Cloud Functions error) when anything is stale or
 * unreadable.
 *
 * Never logs emails or object contents — only timestamps, ages, and counts.
 *
 * Deploy: firebase deploy --only functions:checkBackupFreshness
 * Run now: Cloud Scheduler → firebase-schedule-checkBackupFreshness-us-east1 → Force run
 */
import "./global-options"; // first: global region/ingress/SA (I-10)
import type { Bucket } from "@google-cloud/storage";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { archiveBucketName, firestoreDatabaseId } from "./config";

const TIME_ZONE = "America/Chicago";
const REGION = "us-east1";
const BACKUP_SERVICE_ACCOUNT = "eos-backup@hpb-eos-prod.iam.gserviceaccount.com";
const FIRESTORE_ADMIN = "https://firestore.googleapis.com/v1";

const THRESHOLD_DAYS = {
  backup: 2, // daily managed-backup schedule + slack
  export: 8, // weekly Firestore export + slack
  auth: 8, // weekly Auth export + slack
} as const;

function ensureApp(): void {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault() });
}

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error("checkBackupFreshness: project id not available in the runtime environment");
  return id;
}

async function accessToken(): Promise<string> {
  ensureApp();
  const token = await applicationDefault().getAccessToken();
  return token.access_token;
}

// --- Firestore managed backups ---------------------------------------------

interface FirestoreBackup {
  name: string;
  database: string;
  snapshotTime?: string;
  state?: string;
}

interface ListBackupsResponse {
  backups?: FirestoreBackup[];
  error?: { message: string };
}

async function listFirestoreBackups(token: string): Promise<FirestoreBackup[]> {
  const url = `${FIRESTORE_ADMIN}/projects/${projectId()}/locations/${REGION}/backups`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as ListBackupsResponse;
  if (!res.ok) {
    throw new Error(`Firestore Admin backups list → HTTP ${res.status}: ${body.error?.message ?? "unknown error"}`);
  }
  return body.backups ?? [];
}

/** Newest `snapshotTime` (ISO 8601, lexicographically sortable) among backups for `databaseId`. */
export function newestBackupSnapshotTime(backups: FirestoreBackup[], databaseId: string): string | null {
  const suffix = `/databases/${databaseId}`;
  let newest: string | null = null;
  for (const backup of backups) {
    if (!backup.database?.endsWith(suffix) || !backup.snapshotTime) continue;
    if (!newest || backup.snapshotTime > newest) newest = backup.snapshotTime;
  }
  return newest;
}

// --- Dated-stamp parsing (shared by the Firestore export and Auth export) --

/**
 * A dated backup stamp is either `2026-09-27T160019Z` (current, second
 * granularity — export-firestore.ts / export-auth-users.ts) or the older
 * `2026-09-27T1600Z` (minute granularity, no seconds). Returns a Date, or
 * an invalid Date if `stamp` doesn't match either shape.
 */
export function stampToDate(stamp: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})?Z$/.exec(stamp);
  if (!m) return new Date(NaN);
  const [, date, hh, mm, ss] = m;
  return new Date(`${date}T${hh}:${mm}:${ss ?? "00"}Z`);
}

/**
 * Extracts the dated-folder stamp from a Firestore export object name, e.g.
 * `firestore/2026-09-27T160019Z/output-0` → `2026-09-27T160019Z`. Returns
 * null for anything else, including the undated legacy
 * `firestore/all_namespaces/...` folder from before dated prefixes.
 */
export function parseFirestoreExportStamp(objectName: string): string | null {
  const m = /^firestore\/(\d{4}-\d{2}-\d{2}T(?:\d{6}|\d{4})Z)\//.exec(objectName);
  return m ? m[1] : null;
}

/**
 * Extracts the stamp from an Auth export object name, e.g.
 * `auth/2026-10-04T0400Z-users.json` → `2026-10-04T0400Z`. Returns null for
 * anything else (including the `-summary.json` sidecar).
 */
export function parseAuthExportStamp(objectName: string): string | null {
  const m = /^auth\/(\d{4}-\d{2}-\d{2}T\d{4}Z)-users\.json$/.exec(objectName);
  return m ? m[1] : null;
}

async function newestFirestoreExportTime(bucket: Bucket): Promise<string | null> {
  const [files] = await bucket.getFiles({ prefix: "firestore/", autoPaginate: true });
  let newest: Date | null = null;
  for (const file of files) {
    const stamp = parseFirestoreExportStamp(file.name);
    if (!stamp) continue;
    const d = stampToDate(stamp);
    if (!Number.isNaN(d.getTime()) && (!newest || d > newest)) newest = d;
  }
  return newest ? newest.toISOString() : null;
}

async function newestAuthExportTime(bucket: Bucket): Promise<string | null> {
  const [files] = await bucket.getFiles({ prefix: "auth/", autoPaginate: true });
  let newest: Date | null = null;
  for (const file of files) {
    if (!file.name.endsWith("-users.json")) continue;
    const stamp = parseAuthExportStamp(file.name);
    let d = stamp ? stampToDate(stamp) : null;
    // Fallback for a name that doesn't match the expected shape: the
    // object's own creation time, never its contents.
    if ((!d || Number.isNaN(d.getTime())) && file.metadata?.timeCreated) {
      d = new Date(file.metadata.timeCreated);
    }
    if (d && !Number.isNaN(d.getTime()) && (!newest || d > newest)) newest = d;
  }
  return newest ? newest.toISOString() : null;
}

// --- Age / staleness --------------------------------------------------------

/** Hours between `newest` and `now`, or null if `newest` is unknown/invalid. */
export function ageHours(newest: string | null, now: Date): number | null {
  if (!newest) return null;
  const t = new Date(newest).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round(((now.getTime() - t) / (1000 * 60 * 60)) * 10) / 10;
}

/** No known timestamp counts as stale — an unreadable/missing backup is not "fresh". */
export function isStale(hours: number | null, thresholdDays: number): boolean {
  if (hours === null) return true;
  return hours > thresholdDays * 24;
}

// --- Orchestration -----------------------------------------------------------

interface FreshnessCheck {
  newest: string | null;
  ageHours: number | null;
  stale: boolean;
}

interface BackupFreshnessResult {
  event: "backup_freshness";
  ok: boolean;
  checkedAt: string;
  backup: FreshnessCheck;
  export: FreshnessCheck;
  auth: FreshnessCheck;
  thresholdsDays: typeof THRESHOLD_DAYS;
  errors?: string[];
}

async function checkOne(thresholdDays: number, now: Date, lookup: () => Promise<string | null>, errors: string[], label: string): Promise<FreshnessCheck> {
  try {
    const newest = await lookup();
    const hours = ageHours(newest, now);
    return { newest, ageHours: hours, stale: isStale(hours, thresholdDays) };
  } catch (err) {
    errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return { newest: null, ageHours: null, stale: true };
  }
}

export async function runCheckBackupFreshness(now: Date = new Date()): Promise<BackupFreshnessResult> {
  ensureApp();
  const database = firestoreDatabaseId.value();
  const bucketName = archiveBucketName.value();
  const errors: string[] = [];

  const bucket = getStorage().bucket(bucketName);

  const backup = await checkOne(
    THRESHOLD_DAYS.backup,
    now,
    async () => {
      const token = await accessToken();
      const backups = await listFirestoreBackups(token);
      return newestBackupSnapshotTime(backups, database);
    },
    errors,
    "backup",
  );

  const exportCheck = await checkOne(THRESHOLD_DAYS.export, now, () => newestFirestoreExportTime(bucket), errors, "export");

  const auth = await checkOne(THRESHOLD_DAYS.auth, now, () => newestAuthExportTime(bucket), errors, "auth");

  const stale = backup.stale || exportCheck.stale || auth.stale;
  const ok = !stale && errors.length === 0;

  const result: BackupFreshnessResult = {
    event: "backup_freshness",
    ok,
    checkedAt: now.toISOString(),
    backup,
    export: exportCheck,
    auth,
    thresholdsDays: THRESHOLD_DAYS,
  };

  // Always log the heartbeat once — this line, present or absent, is what
  // the Monitoring alert policies in terraform/monitoring.tf watch.
  console.log(JSON.stringify(result));

  if (!ok) {
    console.error(JSON.stringify({ ...result, errors }));
    throw new Error(`checkBackupFreshness: not ok — ${errors.length > 0 ? errors.join("; ") : "one or more backups are stale"}`);
  }

  return result;
}

export const checkBackupFreshness = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: TIME_ZONE,
    region: REGION,
    serviceAccount: BACKUP_SERVICE_ACCOUNT,
    memory: "256MiB",
    timeoutSeconds: 120,
    retryCount: 1,
  },
  async () => {
    await runCheckBackupFreshness();
  },
);
