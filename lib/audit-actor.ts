// Who made an audited Firestore write — the pure half of the audit trigger's
// actor resolution (C-07, docs/SECURITY_AUDIT_2026-09-08.md).
//
// Lives here rather than in functions/src so the root test suite can cover
// it; functions/tsconfig.json compiles it in alongside lib/todos-archive.ts.
// No imports: the functions build must not pull in app modules.
//
// Order of trust:
//   1. The event's own auth context (client-SDK writes carry the end user's
//      uid). Unforgeable — always wins when present.
//   2. For Admin SDK writes only (authType "service_account" / "unknown"),
//      the stamp a server action put on the doc (lib/audit-stamp.ts):
//      `updated_by` on create/update, `deleted_by` on delete.
//   3. Nothing — actor_uid null, same as before stamping existed.
//
// A stamp is only trusted when *this* write made it. Docs keep their last
// `updated_by` forever, so a later unstamped write (the Monday archive sweep,
// a Google Tasks pull, a CLI script) would otherwise be pinned on whoever
// last edited the doc by hand. Two checks:
//   - update: `updated_at` changed in this write (stamp() sets it to a fresh
//     server timestamp every time), and
//   - every action: the stamp's timestamp is within STAMP_FRESH_MS of the
//     event, which rules out stamps copied verbatim between docs and
//     `deleted_by` left over from a stamp whose delete never ran.

export type AuditAction = "create" | "update" | "delete";

export type ActorSource = "auth_context" | "stamp";

export type ResolvedActor = {
  actorUid: string | null;
  actorSource: ActorSource | null;
};

type FieldMap = Record<string, unknown>;

/** Stamp → event lag we accept. Stamp-then-delete is milliseconds apart. */
export const STAMP_FRESH_MS = 2 * 60 * 1000;

/** authTypes an Admin SDK (server action) write arrives with. */
const SERVER_AUTH_TYPES = new Set(["service_account", "unknown"]);

/** Millis from a Firestore Timestamp (duck-typed — no firebase import here). */
function millisOf(v: unknown): number | null {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    const ms = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Same instant? Firestore Timestamps are microsecond-precise, so compare
 * seconds + nanoseconds when both sides carry them — two stamped writes to
 * one doc inside the same millisecond would otherwise look like "this write
 * didn't touch the stamp". Falls back to millis for anything else.
 */
function sameInstant(a: unknown, b: unknown): boolean {
  const sa = a as { seconds?: unknown; nanoseconds?: unknown } | null | undefined;
  const sb = b as { seconds?: unknown; nanoseconds?: unknown } | null | undefined;
  if (
    typeof sa?.seconds === "number" &&
    typeof sa?.nanoseconds === "number" &&
    typeof sb?.seconds === "number" &&
    typeof sb?.nanoseconds === "number"
  ) {
    return sa.seconds === sb.seconds && sa.nanoseconds === sb.nanoseconds;
  }
  const ma = millisOf(a);
  return ma !== null && ma === millisOf(b);
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function isFresh(stampMs: number | null, eventMs: number): boolean {
  return stampMs !== null && Math.abs(eventMs - stampMs) <= STAMP_FRESH_MS;
}

export function resolveAuditActor(input: {
  action: AuditAction;
  authType: string;
  authId?: string | null;
  before: FieldMap | null;
  after: FieldMap | null;
  /** event.time as epoch millis. */
  eventTimeMs: number;
}): ResolvedActor {
  const authId = nonEmptyString(input.authId);
  if (authId) return { actorUid: authId, actorSource: "auth_context" };

  const none: ResolvedActor = { actorUid: null, actorSource: null };
  if (!SERVER_AUTH_TYPES.has(input.authType)) return none;

  const { action, before, after, eventTimeMs } = input;

  if (action === "delete") {
    const uid = nonEmptyString(before?.deleted_by);
    if (!uid || !isFresh(millisOf(before?.deleted_at), eventTimeMs)) return none;
    return { actorUid: uid, actorSource: "stamp" };
  }

  const uid = nonEmptyString(after?.updated_by);
  const stampedMs = millisOf(after?.updated_at);
  if (!uid || !isFresh(stampedMs, eventTimeMs)) return none;
  if (action === "update" && sameInstant(before?.updated_at, after?.updated_at)) return none;
  return { actorUid: uid, actorSource: "stamp" };
}
