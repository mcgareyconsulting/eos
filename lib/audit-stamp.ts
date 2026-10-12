// Actor stamping for the audit trail (C-07, docs/SECURITY_AUDIT_2026-09-08.md).
//
// Every server action writes through the Admin SDK, so the Firestore audit
// trigger (functions/src/index.ts) sees `authType: "service_account"` and no
// end-user identity. These stamps put the acting user on the document itself
// so the trigger can name them — see lib/audit-actor.ts for how it reads them
// back, and why a stale stamp is never trusted.
//
// Do NOT stamp collections the audit trigger skips (google_tasks_connections,
// oauth_csrf_states, notifications, meetings/{id}/presence): nobody reads the
// stamp there, and the first two hold secrets that shouldn't grow fields.

import { FieldValue, type DocumentReference } from "firebase-admin/firestore";

export type UpdateStamp = { updated_by: string; updated_at: FieldValue };
export type DeleteStamp = { deleted_by: string; deleted_at: FieldValue };

/**
 * `{ updated_by, updated_at }` for the acting user. Spread into every
 * create/update/set(merge) a server action makes on an audited collection.
 */
export function stamp(uid: string): UpdateStamp {
  return { updated_by: uid, updated_at: FieldValue.serverTimestamp() };
}

/** `{ deleted_by, deleted_at }` — written by stampBeforeDelete(), not by callers. */
export function deleteStamp(uid: string): DeleteStamp {
  return { deleted_by: uid, deleted_at: FieldValue.serverTimestamp() };
}

/** gRPC NOT_FOUND, as thrown by the Admin SDK on update() of a missing doc. */
function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 5 || code === "not-found";
}

const STAMP_CONCURRENCY = 50;

/**
 * Write `{ deleted_by, deleted_at }` onto each doc as its own committed write,
 * so the caller's delete that follows carries the actor in its `before`
 * snapshot. The write carries the ordinary update stamp too, so the audit row
 * this stamp itself produces (an update touching only the stamp fields) is
 * attributed as well, rather than sitting in the log as an anonymous edit.
 *
 * Why a separate write: an onWrite trigger sees only the net change of a
 * batch or transaction, so a stamp in the same batch as the delete is
 * invisible — the trigger gets before = the doc as it was, after = nothing.
 *
 * Fails closed: any error other than NOT_FOUND propagates and the caller's
 * delete never runs, so an app delete is never left unattributed in the log.
 * The stamp and the delete hit the same document in the same database, so a
 * stamp that fails for any real reason means the delete would very likely
 * fail too; the user just retries. NOT_FOUND is swallowed — the doc is
 * already gone and there is nothing to attribute or delete.
 */
export async function stampBeforeDelete(
  refs: DocumentReference | readonly DocumentReference[],
  uid: string,
): Promise<void> {
  const list = Array.isArray(refs) ? refs : [refs as DocumentReference];
  for (let i = 0; i < list.length; i += STAMP_CONCURRENCY) {
    await Promise.all(
      list.slice(i, i + STAMP_CONCURRENCY).map((ref) =>
        ref.update({ ...stamp(uid), ...deleteStamp(uid) }).catch((err: unknown) => {
          if (!isNotFound(err)) throw err;
        }),
      ),
    );
  }
}
