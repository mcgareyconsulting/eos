/**
 * Shared Functions params. `.env.hpb-eos-prod` (loaded by the CLI for this
 * project) sets FIRESTORE_DATABASE_ID=hpb-eos-prod-db — the project has no
 * `(default)` Firestore database. It also sets ARCHIVE_BUCKET to the prod
 * backup bucket used by scheduled exports (Firestore export job +
 * `exportAuthUsers` below).
 */
import { defineString } from "firebase-functions/params";

export const firestoreDatabaseId = defineString("FIRESTORE_DATABASE_ID", {
  default: "hpb-eos-prod-db",
  description: "Named Firestore database id (prod has no (default) DB)",
});

/**
 * GCS bucket that holds scheduled backups: the nightly/weekly Firestore
 * export and the weekly Firebase Auth user export (export-auth-users.ts).
 * Private bucket, 7-year retention, same access boundary as prod — see
 * docs/OPERATIONS.md.
 */
export const archiveBucketName = defineString("ARCHIVE_BUCKET", {
  default: "hpb-eos-prod-archive",
  description: "GCS bucket for scheduled backups (Firestore export, Auth user export)",
});
