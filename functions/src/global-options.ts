/**
 * Options every function in this codebase inherits (I-10 in
 * docs/SECURITY_AUDIT_2026-09-08.md).
 *
 * WHY A SEPARATE MODULE: firebase-functions v2 reads the global options at
 * the moment `onSchedule(...)` / `onDocumentWritten...(...)` is *called*,
 * i.e. while each module is being evaluated — not lazily at deploy. When
 * `setGlobalOptions` sat in the body of index.ts it ran only after every
 * re-exported module had already been evaluated (imports are hoisted), so
 * `exportAuthUsers` and `archiveStaleTodos` silently ignored it and deployed
 * to us-central1 (HARDENING_LOG, 2026-09-27). Every module that defines a
 * function imports this file as its FIRST import, so Node's module cache
 * guarantees these options are set before any function is defined,
 * regardless of the order index.ts lists them in.
 *
 * - region: us-east1, next to the regional `hpb-eos-prod-db` (a 2nd-gen
 *   Firestore trigger must live in its database's region; see index.ts).
 * - ingressSettings ALLOW_INTERNAL_ONLY: nothing here is meant to be called
 *   from the internet. Google's Cloud Run ingress docs list Cloud Scheduler,
 *   Eventarc and Pub/Sub push subscriptions in the same project as
 *   "internal" sources when they target the default run.app URL — which is
 *   what Firebase's Scheduler jobs (`httpTarget.uri = endpoint.uri`) and the
 *   Firestore Eventarc triggers use. So both trigger kinds keep working.
 * - serviceAccount eos-functions: dedicated least-privilege identity
 *   (terraform/functions.tf) instead of the Compute Engine default SA, which
 *   holds roles/editor. Functions that need different access declare their
 *   own `serviceAccount` (exportFirestore / checkBackupFreshness run as
 *   eos-backup); per-function options override these.
 */
import { setGlobalOptions } from "firebase-functions/v2";

export const FUNCTIONS_REGION = "us-east1";
export const FUNCTIONS_SERVICE_ACCOUNT = "eos-functions@hpb-eos-prod.iam.gserviceaccount.com";

setGlobalOptions({
  region: FUNCTIONS_REGION,
  ingressSettings: "ALLOW_INTERNAL_ONLY",
  serviceAccount: FUNCTIONS_SERVICE_ACCOUNT,
});
