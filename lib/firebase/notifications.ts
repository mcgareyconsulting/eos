// In-app notifications — the Firestore half (Admin SDK; server actions only).
//
// Every row is one recipient × one event, written in a single batch so a
// fan-out either lands whole or not at all. Callers decide *who* with the
// helpers in lib/notifications.ts and hand the list here; this only writes.
//
// Best-effort by contract: a notification is a courtesy on top of a write
// that has already succeeded (the comment is posted, the to-do is done), so
// `notify` logs and swallows rather than failing the action that called it.

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type {
  NotificationDoc,
  NotificationEntityType,
  NotificationKind,
} from "@/lib/notifications";
import { loadUserNames } from "./user-names";

export type NotifyArgs = {
  db: Firestore;
  recipientIds: readonly string[];
  kind: NotificationKind;
  team: { id: string; name: string };
  entity: { type: NotificationEntityType; id: string; title: string };
  actor: { id: string; name?: string | null };
  detail?: string | null;
};

/** Actor label for a row; resolved once per fan-out, never per recipient. */
export async function resolveActorName(
  db: Firestore,
  actor: { id: string; name?: string | null },
): Promise<string> {
  if (actor.name?.trim()) return actor.name.trim();
  const names = await loadUserNames(db, [actor.id]);
  return names.get(actor.id) ?? "Someone";
}

/** Writes one row per recipient. Zero recipients writes nothing. */
export async function writeNotifications(args: NotifyArgs): Promise<number> {
  const ids = [...new Set(args.recipientIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  const actorName = await resolveActorName(args.db, args.actor);
  const batch = args.db.batch();
  const col = args.db.collection("notifications");
  for (const uid of ids) {
    const row: NotificationDoc = {
      user_id: uid,
      team_id: args.team.id,
      team_name: args.team.name,
      entity_type: args.entity.type,
      entity_id: args.entity.id,
      entity_title: args.entity.title,
      kind: args.kind,
      actor_id: args.actor.id,
      actor_name: actorName,
      detail: args.detail?.trim() || null,
      created_at: FieldValue.serverTimestamp(),
      read_at: null,
      archived_at: null,
    };
    batch.set(col.doc(), row);
  }
  await batch.commit();
  return ids.length;
}

/** `writeNotifications`, but never throws — see the header. */
export async function notify(args: NotifyArgs): Promise<void> {
  try {
    await writeNotifications(args);
  } catch (e) {
    console.error(
      `[notifications] ${args.kind} on ${args.entity.type}/${args.entity.id} failed:`,
      e,
    );
  }
}
