/**
 * Sunday ~4:00 America/Chicago — one hour after the Firestore export
 * scheduler job — export every Firebase Auth user to Cloud Storage as a
 * `firebase auth:import`-compatible JSON file.
 *
 * Firebase Auth has no bulk-restore console and no export API for the
 * client itself. If the user directory were ever wiped, disabled en masse,
 * or lost to a botched migration, this is what rebuilds it — uids, emails,
 * sign-in providers, and (critically) the `role: "admin"` custom claim the
 * app's own authorization checks depend on. No password hashes are
 * expected, since every user signs in via Google.
 *
 * SECURITY:
 * - The export object contains user emails and uids (PII). No password
 *   hashes are expected in practice; `passwordHash`/`salt` are only
 *   included when a `UserRecord` actually carries them (e.g. a legacy or
 *   migrated account), since `auth:import` needs both together or neither.
 * - Written to a private bucket with 7-year retention, the same access
 *   boundary as prod Firestore (see docs/OPERATIONS.md) — nobody should be
 *   able to read this object who doesn't already have admin access to the
 *   Firebase project.
 * - Never log user emails or the export body itself. Only counts and the
 *   object path are logged (see the structured log line below).
 * - This function throws on any failure so it shows up as a Cloud
 *   Functions error in logs; the "Auth export (backup) failed" alert policy
 *   (terraform/monitoring.tf) pages on that error, and the daily
 *   checkBackupFreshness function catches a silently skipped run.
 *
 * FORMAT: top-level `{ "users": [...] }`, one object per user, restricted
 * to the fields `firebase auth:import` actually accepts. The public docs
 * page (https://firebase.google.com/docs/cli/auth) renders client-side and
 * didn't yield a field list to this session's fetch tooling, so the
 * authoritative source used here is the firebase-tools CLI implementation
 * itself — `ALLOWED_JSON_KEYS` / `ALLOWED_PROVIDER_USER_INFO_KEYS` in
 * https://github.com/firebase/firebase-tools/blob/master/src/accountImporter.ts
 * (checked 2026-09-27):
 *   localId, email, emailVerified, passwordHash, salt, displayName,
 *   photoUrl, createdAt, lastSignedInAt, providerUserInfo (each entry:
 *   providerId, rawId, email, displayName, photoUrl), phoneNumber,
 *   disabled, customAttributes, mfaInfo.
 * `createdAt` / `lastSignedInAt` must be milliseconds-since-epoch as
 * strings — `UserRecord.metadata` instead gives UTC date strings, so they
 * are converted below.
 *
 * Deploy: firebase deploy --only functions:exportAuthUsers
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { archiveBucketName } from "./config";

const TIME_ZONE = "America/Chicago";
const LIST_USERS_PAGE_SIZE = 1000;

function ensureApp(): void {
  if (getApps().length === 0) initializeApp();
}

interface AuthImportProviderInfo {
  providerId: string;
  rawId: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
}

/** Shape matches `firebase auth:import`'s accepted per-user fields — see file header. */
interface AuthImportUser {
  localId: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  photoUrl?: string;
  disabled: boolean;
  customAttributes?: string;
  providerUserInfo: AuthImportProviderInfo[];
  createdAt: string;
  lastSignedInAt: string;
  passwordHash?: string;
  salt?: string;
}

/** `UserRecord.metadata` gives UTC date strings; `auth:import` wants ms-since-epoch strings. */
function toEpochMsString(dateString: string | undefined): string {
  const ms = dateString ? new Date(dateString).getTime() : NaN;
  return Number.isFinite(ms) ? String(ms) : "0";
}

function toAuthImportUser(user: UserRecord): AuthImportUser {
  const out: AuthImportUser = {
    localId: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    photoUrl: user.photoURL,
    disabled: user.disabled,
    providerUserInfo: user.providerData.map((p) => ({
      providerId: p.providerId,
      rawId: p.uid,
      email: p.email || undefined,
      displayName: p.displayName || undefined,
      photoUrl: p.photoURL || undefined,
    })),
    createdAt: toEpochMsString(user.metadata.creationTime),
    lastSignedInAt: toEpochMsString(user.metadata.lastSignInTime),
  };
  // Carries the org's `role: "admin"` claim (see lib/auth or equivalent) —
  // this is the field a restore actually depends on.
  if (user.customClaims && Object.keys(user.customClaims).length > 0) {
    out.customAttributes = JSON.stringify(user.customClaims);
  }
  // No password hash is expected (Google sign-in only), but carry one
  // through if a UserRecord ever has one so a legacy/migrated account
  // round-trips through auth:import intact.
  if (user.passwordHash) out.passwordHash = user.passwordHash;
  if (user.passwordSalt) out.salt = user.passwordSalt;
  return out;
}

function isAdminUser(importUser: AuthImportUser): boolean {
  if (!importUser.customAttributes) return false;
  try {
    return JSON.parse(importUser.customAttributes)?.role === "admin";
  } catch {
    return false;
  }
}

async function listAllUsers(): Promise<UserRecord[]> {
  const auth = getAuth();
  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(LIST_USERS_PAGE_SIZE, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

/** `auth/<YYYY-MM-DD>T<HHMM>Z-users.json` (+ a `-summary.json` sidecar), timestamped in UTC. */
function objectPaths(now: Date): { usersPath: string; summaryPath: string } {
  const iso = now.toISOString(); // e.g. "2026-10-04T04:00:12.345Z"
  const date = iso.slice(0, 10); // "2026-10-04"
  const hhmm = iso.slice(11, 13) + iso.slice(14, 16); // "0400"
  const base = `auth/${date}T${hhmm}Z-users`;
  return { usersPath: `${base}.json`, summaryPath: `${base}-summary.json` };
}

export interface ExportAuthUsersResult {
  bucket: string;
  object: string;
  userCount: number;
  adminCount: number;
}

export async function runExportAuthUsers(now: Date = new Date()): Promise<ExportAuthUsersResult> {
  ensureApp();

  const bucketName = archiveBucketName.value();
  if (!bucketName) {
    throw new Error("exportAuthUsers: ARCHIVE_BUCKET is unset — refusing to export with no destination.");
  }

  const users = await listAllUsers();
  const importUsers = users.map(toAuthImportUser);
  const adminCount = importUsers.filter(isAdminUser).length;

  const { usersPath, summaryPath } = objectPaths(now);
  const bucket = getStorage().bucket(bucketName);

  const summary = {
    exportedAt: now.toISOString(),
    userCount: importUsers.length,
    adminCount,
    bucket: bucketName,
    object: usersPath,
  };

  // Fail loudly: an unset bucket or a rejected write must surface as a
  // Cloud Functions error, not a silently-skipped backup.
  await bucket.file(usersPath).save(JSON.stringify({ users: importUsers }), {
    contentType: "application/json",
    resumable: false,
  });
  await bucket.file(summaryPath).save(JSON.stringify(summary), {
    contentType: "application/json",
    resumable: false,
  });

  return { bucket: bucketName, object: usersPath, userCount: importUsers.length, adminCount };
}

export const exportAuthUsers = onSchedule(
  {
    schedule: "0 4 * * 0",
    timeZone: TIME_ZONE,
    // Pinned explicitly: setGlobalOptions in index.ts runs after this module
    // is evaluated (imports are hoisted), so the global region never applied
    // and the first deploy (2026-09-27) landed in us-central1.
    region: "us-east1",
    memory: "256MiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async () => {
    const result = await runExportAuthUsers();
    // Structured summary only — never log emails or the export body.
    console.log(
      JSON.stringify({
        msg: "exportAuthUsers complete",
        timeZone: TIME_ZONE,
        bucket: result.bucket,
        object: result.object,
        userCount: result.userCount,
        adminCount: result.adminCount,
      }),
    );
  },
);
