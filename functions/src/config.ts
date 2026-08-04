/**
 * Shared Functions params. `.env.hpb-eos-prod` (loaded by the CLI for this
 * project) sets FIRESTORE_DATABASE_ID=hpb-eos-prod-db — the project has no
 * `(default)` Firestore database.
 */
import { defineString } from "firebase-functions/params";

export const firestoreDatabaseId = defineString("FIRESTORE_DATABASE_ID", {
  default: "hpb-eos-prod-db",
  description: "Named Firestore database id (prod has no (default) DB)",
});
