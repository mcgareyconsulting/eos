// Access-change audit records and the admin-view log (docs/PERMISSIONS_SPEC.md
// section 6). Pure row shaping up top; the writers at the bottom take an
// Admin SDK Firestore and add rows to `audit_log` (the generic write trigger
// skips that collection, so these rows do not loop).
//
// Row shape (both kinds share the audit_log core fields):
//   entity_type  "access_change" | "admin_view"
//   action       "access_change" | "admin_view"
//   change_kind  access_change only - see AccessChangeKind
//   entity_id    the item / person / team the change is about
//   actor_uid    who did it (the server action's authenticated user)
//   actor_source "app"
//   team_id      team the change belongs to, or null
//   target_uid   the person whose access moved (roster, role, admin), or null
//   before/after the access-relevant fields only, never item content
//   timestamp    server time

import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type AccessChangeKind =
  | "rock_audience"
  | "rock_private"
  | "metric_public"
  | "track"
  | "roster"
  | "leader_role"
  | "admin_role"
  | "feedback_tracker"
  | "deactivation";

export type AccessChangeInput = {
  kind: AccessChangeKind;
  actorUid: string;
  entityId: string;
  teamId?: string | null;
  targetUid?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export function accessChangeRow(input: AccessChangeInput) {
  return {
    entity_type: "access_change" as const,
    action: "access_change" as const,
    change_kind: input.kind,
    entity_id: input.entityId,
    actor_uid: input.actorUid,
    actor_source: "app" as const,
    team_id: input.teamId ?? null,
    target_uid: input.targetUid ?? null,
    before: input.before,
    after: input.after,
  };
}

/** UTC calendar day, `YYYY-MM-DD`. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** One admin-view row per admin per team per day: the doc id is the dedupe. */
export function adminViewDocId(uid: string, teamId: string, now: Date): string {
  return `admin_view__${uid}__${teamId}__${dayKey(now)}`;
}

export function adminViewRow(uid: string, teamId: string, now: Date) {
  return {
    entity_type: "admin_view" as const,
    action: "admin_view" as const,
    entity_id: teamId,
    actor_uid: uid,
    actor_source: "app" as const,
    team_id: teamId,
    day: dayKey(now),
  };
}

/** Set-valued field diff for audience-style lists. */
export function diffIds(before: readonly string[], after: readonly string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((id) => !b.has(id)),
    removed: before.filter((id) => !a.has(id)),
  };
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists";
}

/**
 * Append one access_change row. Never throws: the access change itself has
 * already happened, and a log failure must not turn it into a user-facing
 * error. Failures go to the server log.
 */
export async function recordAccessChange(
  db: Firestore,
  input: AccessChangeInput,
): Promise<void> {
  try {
    await db
      .collection("audit_log")
      .add({ ...accessChangeRow(input), timestamp: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error("access_change audit write failed", input.kind, err);
  }
}

export async function recordAccessChanges(
  db: Firestore,
  inputs: readonly AccessChangeInput[],
): Promise<void> {
  await Promise.all(inputs.map((i) => recordAccessChange(db, i)));
}

/** Record an admin opening a team they are not a member of; deduped per day. */
export async function recordAdminView(
  db: Firestore,
  uid: string,
  teamId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await db
      .collection("audit_log")
      .doc(adminViewDocId(uid, teamId, now))
      .create({ ...adminViewRow(uid, teamId, now), timestamp: FieldValue.serverTimestamp() });
  } catch (err) {
    if (!isAlreadyExists(err)) console.error("admin_view audit write failed", err);
  }
}

// ---------------------------------------------------------------------------
// Event shaping for items
// ---------------------------------------------------------------------------

type RockAccessFields = {
  audience_team_ids: readonly string[];
  audience_user_ids: readonly string[];
  private: boolean;
};

/**
 * access_change rows for one rock save: one `rock_audience` row when either
 * audience list changed (before/after carry both lists, plus the added and
 * removed ids), one `rock_private` row when Private flipped. Empty when
 * nothing about who can see the rock changed.
 */
export function rockAccessEvents(
  actorUid: string,
  rockId: string,
  teamId: string,
  before: RockAccessFields,
  after: RockAccessFields,
): AccessChangeInput[] {
  const out: AccessChangeInput[] = [];
  const teams = diffIds(before.audience_team_ids, after.audience_team_ids);
  const users = diffIds(before.audience_user_ids, after.audience_user_ids);
  const audienceChanged =
    teams.added.length + teams.removed.length + users.added.length + users.removed.length > 0;
  if (audienceChanged) {
    out.push({
      kind: "rock_audience",
      actorUid,
      entityId: rockId,
      teamId,
      before: {
        audience_team_ids: [...before.audience_team_ids],
        audience_user_ids: [...before.audience_user_ids],
      },
      after: {
        audience_team_ids: [...after.audience_team_ids],
        audience_user_ids: [...after.audience_user_ids],
        added_team_ids: teams.added,
        removed_team_ids: teams.removed,
        added_user_ids: users.added,
        removed_user_ids: users.removed,
      },
    });
  }
  if (before.private !== after.private) {
    out.push({
      kind: "rock_private",
      actorUid,
      entityId: rockId,
      teamId,
      before: { private: before.private },
      after: { private: after.private },
    });
  }
  return out;
}
