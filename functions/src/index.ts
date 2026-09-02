/**
 * Cloud Functions for Firebase (2nd gen).
 *
 * 1) Audit log capture — DECIDED (docs/ROADMAP.md): server-side Firestore
 *    triggers so nothing bypasses the log. Deploy only after triggers are
 *    pointed at the named database (see OPERATIONS / CUTOVER).
 *
 * 2) Monday archive sweep — `archiveStaleTodos` (scheduler): pure to-dos,
 *    closed issues, discussed headlines, and done rocks. Safe to deploy
 *    independently; uses FIRESTORE_DATABASE_ID (default hpb-eos-prod-db).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  onDocumentWrittenWithAuthContext,
  type FirestoreAuthEvent,
  type Change,
  type DocumentSnapshot,
} from "firebase-functions/v2/firestore";
import { firestoreDatabaseId } from "./config";

// Re-export scheduled todo archive (Monday 3am America/Chicago).
export { archiveStaleTodos } from "./archive-stale-todos";

initializeApp();

// us-east1, because that is where the database is. `hpb-eos-prod-db` is a
// *regional* Firestore instance pinned to us-east1 (permanent — see
// cutover-plan "Cloud Run goes in us-east1"), and a 2nd-gen Firestore trigger
// has to be created in its database's region. This read "us-central1" with a
// comment claiming it matched Cloud Run; Cloud Run is us-east1 too, so the
// value contradicted its own reason and both audit triggers failed to deploy
// with a bare "Failed to create function" (2026-09-02).
//
// The trial project never caught this: its database is `nam5` multi-region,
// which already contains us-central1, so the same code deployed there fine.
setGlobalOptions({ region: "us-east1" });

/** Named DB — never `(default)` on hpb-eos-prod. */
function auditDb() {
  const id = firestoreDatabaseId.value();
  return id ? getFirestore(id) : getFirestore();
}

type AuditAction = "create" | "update" | "delete";

/** A doc's field map with Firestore Timestamps possibly nested at the top level. */
type FieldMap = Record<string, unknown>;

/**
 * Shallow-equality check for a single field value, safe for Firestore
 * Timestamps (which are objects, so `===` and naive JSON.stringify would
 * otherwise disagree on equal instants with different internal representations).
 */
function fieldsEqual(a: unknown, b: unknown): boolean {
  const na = a instanceof Timestamp ? a.toMillis() : a;
  const nb = b instanceof Timestamp ? b.toMillis() : b;
  if (na === nb) return true;
  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

/** Shallow diff (top-level keys only) between the before/after field maps of an update. */
function changedKeys(before: FieldMap | null, after: FieldMap | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!fieldsEqual(before?.[key], after?.[key])) changed.push(key);
  }
  return changed.sort();
}

/**
 * Builds and writes one immutable audit_log row for a single document
 * create/update/delete. Shared by every trigger below.
 */
async function recordAuditEvent(
  entityType: string,
  event: FirestoreAuthEvent<Change<DocumentSnapshot> | undefined>
): Promise<void> {
  const change = event.data;
  if (!change) return;

  const { before: beforeSnap, after: afterSnap } = change;
  const before = beforeSnap.exists ? (beforeSnap.data() as FieldMap) : null;
  const after = afterSnap.exists ? (afterSnap.data() as FieldMap) : null;

  const action: AuditAction = !beforeSnap.exists ? "create" : !afterSnap.exists ? "delete" : "update";

  await auditDb()
    .collection("audit_log")
    .add({
      entity_type: entityType,
      entity_id: afterSnap.exists ? afterSnap.id : beforeSnap.id,
      action,
      // authId is only populated when the write carries an end-user identity
      // (client SDK writes, or Admin SDK calls made "on behalf of" a user via
      // impersonation). Plain Admin SDK writes — server actions, seed scripts —
      // show up as authType "service_account"/"unknown" with no authId.
      actor_uid: event.authId ?? null,
      auth_type: event.authType,
      timestamp: FieldValue.serverTimestamp(),
      before,
      after,
      changed_keys: action === "update" ? changedKeys(before, after) : [],
    });
}

// ---------------------------------------------------------------------------
// Top-level collections: {collection}/{docId}
//
// Covers organizations, users, teams, team_members, team_join_requests,
// rocks, rock_status_updates, todos, issues, issue_votes, headlines,
// scorecard_metrics, scorecard_entries, meetings, and any future top-level
// collection — nothing to add here as the schema grows.
//
// LOOP GUARD: audit_log itself is a top-level collection, so it matches this
// wildcard. Writing an audit row for a write to audit_log would recurse
// forever — bail out before doing anything else.
//
// SECRET GUARD: google_tasks_connections holds per-user Google OAuth
// refresh/access tokens and oauth_csrf_states holds one-time OAuth secrets.
// Copying their before/after snapshots would move those secrets into a log
// that admins can read (firestore.rules) and that keeps them forever
// (append-only, surviving disconnect). Neither collection is a business
// record, so skip them entirely.
// ---------------------------------------------------------------------------
const AUDIT_EXCLUDED_COLLECTIONS = new Set([
  "audit_log",
  "google_tasks_connections",
  "oauth_csrf_states",
]);

export const auditTopLevelWrites = onDocumentWrittenWithAuthContext(
  {
    document: "{collection}/{docId}",
    // Required: hpb-eos-prod has no (default) database. CLI deploy fails if
    // this is omitted (it probes (default) and 404s).
    database: firestoreDatabaseId,
  },
  async (event) => {
    const { collection } = event.params;
    if (AUDIT_EXCLUDED_COLLECTIONS.has(collection)) return;
    await recordAuditEvent(collection, event);
  },
);

// ---------------------------------------------------------------------------
// meetings/{meetingId}/effectiveness_scores/{scoreId}
//
// One doc per attendee holding their end-of-meeting rating of the meeting
// itself (1-10, optional note) — not a peer rating of other attendees.
// Collection name kept as `effectiveness_scores` for path stability (this
// trigger + firestore.rules) even though the doc shape changed.
//
// Subcollections aren't matched by the single-segment wildcard above, so
// this needs its own trigger. Deliberately no trigger exists for
// meetings/{meetingId}/presence — that's ephemeral in-meeting state, not an
// auditable business record.
// ---------------------------------------------------------------------------
export const auditEffectivenessScoreWrites = onDocumentWrittenWithAuthContext(
  {
    document: "meetings/{meetingId}/effectiveness_scores/{scoreId}",
    database: firestoreDatabaseId,
  },
  async (event) => {
    await recordAuditEvent("effectiveness_scores", event);
  },
);
