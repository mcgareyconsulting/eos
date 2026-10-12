// In-app notifications — the Firestore half (Admin SDK; server actions only).
//
// `emitEvent` is the one entry point (docs/PERMISSIONS_SPEC.md §5.3): give it
// an `ItemRef`, the follower event (or null) and who was named directly
// (mentioned, assigned…), and it
//   1. loads the item and its followers (lib/follow.ts: stored
//      `follower_ids` + the locked owner and assigner),
//   2. plans one delivery per person (lib/notifications.ts planRecipients),
//   3. drops every recipient who cannot see the item (`canSee`, Viewer built
//      from team_members + the admin claim) — the send-time check,
//   4. writes one pointer-only row per remaining recipient, in one batch.
//
// Best-effort by contract: a notification is a courtesy on top of a write
// that has already succeeded (the comment is posted, the to-do is done), so
// `emitEvent` and `notify` log and swallow rather than fail the action.

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { ItemEvent, ItemRef } from "@/lib/item-registry";
import { effectiveFollowers } from "@/lib/follow";
import {
  filterByAccess,
  planRecipients,
  type Delivery,
  type DirectKind,
  type NotificationDoc,
  type NotificationEntityType,
} from "@/lib/notifications";
import { canSeeItem, loadItem, loadViewers, type ViewerDeps } from "./items";
import { loadUserNames } from "./user-names";

/** Actor label for the activity trace; resolved once per write. */
export async function resolveActorName(
  db: Firestore,
  actor: { id: string; name?: string | null },
): Promise<string> {
  if (actor.name?.trim()) return actor.name.trim();
  const names = await loadUserNames(db, [actor.id]);
  return names.get(actor.id) ?? "Someone";
}

/**
 * Writes one pointer row per delivery, in one batch. No access check — use
 * `emitEvent`. Zero deliveries writes nothing.
 */
export async function writeNotifications(args: {
  db: Firestore;
  ref: ItemRef;
  teamId: string;
  actorId: string;
  event: ItemEvent | null;
  deliveries: readonly Delivery[];
}): Promise<number> {
  const seen = new Set<string>();
  const rows = args.deliveries.filter((d) => {
    if (!d.uid || seen.has(d.uid)) return false;
    seen.add(d.uid);
    return true;
  });
  if (rows.length === 0) return 0;
  const batch = args.db.batch();
  const col = args.db.collection("notifications");
  for (const d of rows) {
    const row: NotificationDoc = {
      user_id: d.uid,
      team_id: args.teamId,
      entity_type: args.ref.type,
      entity_id: args.ref.id,
      kind: d.kind,
      // Direct rows keep the event as context (a mention is on a comment).
      event: args.event,
      actor_id: args.actorId,
      created_at: FieldValue.serverTimestamp(),
      read_at: null,
      archived_at: null,
    };
    batch.set(col.doc(), row);
  }
  await batch.commit();
  return rows.length;
}

export type EmitOptions = {
  /**
   * The team the action ran from. The row files under the item's own
   * `team_id` when it has one (a milestone ticked from a guest team is still
   * an event on the rock's team); this is the fallback.
   */
  teamId: string;
  /** People named directly, by kind (mention, assigned, unassigned…). */
  direct?: Partial<Record<DirectKind, readonly (string | null | undefined)[]>>;
  /** Test seam: admin-claim lookup (defaults to Firebase Auth). */
  viewerDeps?: ViewerDeps;
};

/**
 * Who `emitEvent` would notify, after the access check. Exported for tests
 * and for callers that want the list without writing.
 */
export async function resolveEventRecipients(
  db: Firestore,
  ref: ItemRef,
  event: ItemEvent | null,
  actorUid: string,
  opts: EmitOptions,
): Promise<{ ref: ItemRef; teamId: string; deliveries: Delivery[] } | null> {
  const item = await loadItem(db, ref);
  if (!item) return null;
  const plan = planRecipients({
    followers: event ? effectiveFollowers(item.ref.type, item.data) : [],
    event,
    actorId: actorUid,
    direct: opts.direct,
  });
  if (plan.length === 0) {
    return { ref: item.ref, teamId: item.teamId || opts.teamId, deliveries: [] };
  }
  const viewers = await loadViewers(
    db,
    plan.map((d) => d.uid),
    opts.viewerDeps,
  );
  const deliveries = filterByAccess(plan, (uid) => {
    const v = viewers.get(uid);
    return !!v && canSeeItem(item, v);
  });
  return { ref: item.ref, teamId: item.teamId || opts.teamId, deliveries };
}

/**
 * Notify about one event on one item. `event` is a follower event from the
 * item's registry entry (spec §5.3 "Events for followers"), or null when
 * only the `direct` recipients should hear (e.g. a bare assignment).
 * Never throws; returns the number of rows written.
 */
export async function emitEvent(
  db: Firestore,
  ref: ItemRef,
  event: ItemEvent | null,
  actorUid: string,
  opts: EmitOptions,
): Promise<number> {
  try {
    const r = await resolveEventRecipients(db, ref, event, actorUid, opts);
    if (!r) return 0;
    return await writeNotifications({
      db,
      ref: r.ref,
      teamId: r.teamId,
      actorId: actorUid,
      event,
      deliveries: r.deliveries,
    });
  } catch (e) {
    console.error(
      `[notifications] ${event ?? "direct"} on ${ref.type}/${ref.id} failed:`,
      e,
    );
    return 0;
  }
}

/**
 * The pre-P5 call shape, kept for callers outside this package's reach
 * (rocks/actions.ts used it until P6b; it now calls
 * `emitEvent` directly). `team.name`, `entity.title` and `detail` are IGNORED (rows
 * are pointer-only); the access check applies.
 */
export type NotifyArgs = {
  db: Firestore;
  recipientIds: readonly string[];
  kind: DirectKind;
  team: { id: string; name?: string };
  entity: { type: NotificationEntityType; id: string; title?: string };
  actor: { id: string; name?: string | null };
  detail?: string | null;
};

/** @deprecated use `emitEvent`. Direct-kind rows only; never throws. */
export async function notify(args: NotifyArgs): Promise<void> {
  await emitEvent(
    args.db,
    { type: args.entity.type, id: args.entity.id },
    null,
    args.actor.id,
    { teamId: args.team.id, direct: { [args.kind]: args.recipientIds } },
  );
}
