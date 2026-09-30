// Actor stamps for Admin SDK writes (C-07, docs/SECURITY_AUDIT_2026-09-08.md).
//
// Every server action writes through the Admin SDK, which carries no end-user
// identity: the audit-log trigger (functions/src/index.ts) sees
// `auth_type: service_account` and an empty `actor_uid`. The only way the
// trail can say *who* changed a record is for the record itself to carry it,
// so every update/set of a business document merges `stamp(uid)` and every
// hard delete is preceded by `deleteStamp(uid)`. The trigger then reads
// `after.updated_by` (or `before.deleted_by` on a delete) as the actor.
//
// Conventions:
// - `uid` is the signed-in user from requireTeamAccess / requireTeamLeader /
//   requireAdmin. Automated writers use a `system:<job>` string instead
//   (see SYSTEM_ACTOR) so a row is never mistaken for a person's.
// - Ephemeral or excluded collections (meeting presence, notifications,
//   google_tasks_connections, oauth_csrf_states) are not stamped: the
//   trigger ignores them and the stamp would only add write volume.
// - A cascade delete (a rock's milestones, an issue's votes and comments)
//   stamps the parent only. The child rows reference the parent by id, and
//   the parent's delete row names the actor.

import { FieldValue } from "firebase-admin/firestore";

export type ActorStamp = {
  updated_by: string;
  updated_at: FieldValue;
};

export type DeleteStamp = {
  deleted_by: string;
  deleted_at: FieldValue;
};

/** Merge into every update/set of a business document. */
export function stamp(uid: string): ActorStamp {
  return { updated_by: uid, updated_at: FieldValue.serverTimestamp() };
}

/**
 * Write with `ref.update(deleteStamp(uid))` immediately before a hard
 * delete, as its own write (not in the same batch as the delete) so the
 * audit trigger sees the actor in the delete event's `before` snapshot.
 */
export function deleteStamp(uid: string): DeleteStamp {
  return { deleted_by: uid, deleted_at: FieldValue.serverTimestamp() };
}

/** Actor id for a scheduled or system writer, e.g. SYSTEM_ACTOR("archiveStaleTodos"). */
export function SYSTEM_ACTOR(job: string): string {
  return `system:${job}`;
}
