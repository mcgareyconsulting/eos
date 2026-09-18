// Per-entity activity trace — the Firestore half (Admin SDK; server actions
// only). See lib/activity.ts for what a row is and why it exists.
//
// Best-effort by contract, like notifications: the trace is a courtesy on
// top of a write that has already succeeded, so `recordActivity` logs and
// swallows rather than failing the action that called it.

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type {
  ActivityDoc,
  ActivityEntityType,
  ActivityKind,
} from "@/lib/activity";
import { resolveActorName } from "./notifications";

export type RecordActivityArgs = {
  db: Firestore;
  teamId: string;
  entity: {
    type: ActivityEntityType;
    id: string;
    /** The entity's *current* visibility and owner — see ActivityDoc. An
     *  issue has no visibility; leave it out and the row says "team". */
    visibility?: string | null | undefined;
    ownerId: string | null | undefined;
  };
  kind: ActivityKind;
  actor: { id: string; name?: string | null };
  detail?: string | null;
};

export async function writeActivity(args: RecordActivityArgs): Promise<void> {
  const row: ActivityDoc = {
    team_id: args.teamId,
    entity_type: args.entity.type,
    entity_id: args.entity.id,
    visibility: args.entity.visibility === "private" ? "private" : "team",
    owner_id: args.entity.ownerId || null,
    kind: args.kind,
    actor_id: args.actor.id,
    actor_name: await resolveActorName(args.db, args.actor),
    detail: args.detail?.trim() || null,
    created_at: FieldValue.serverTimestamp(),
  };
  await args.db.collection("entity_activity").doc().set(row);
}

/** `writeActivity`, but never throws — see the header. */
export async function recordActivity(args: RecordActivityArgs): Promise<void> {
  try {
    await writeActivity(args);
  } catch (e) {
    console.error(
      `[activity] ${args.kind} on ${args.entity.type}/${args.entity.id} failed:`,
      e,
    );
  }
}
