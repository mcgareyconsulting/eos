// Read-time labels for pointer-only notification rows (docs/PERMISSIONS_SPEC.md
// §5.3 "Access rules": "When you open a notification, the application checks
// your access. Then it shows the title and the text."). Admin SDK; server
// only. The server actions in app/(app)/notifications/actions.ts wrap these.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access";
import { isItemType, linkFor, type ItemRef } from "@/lib/item-registry";
import { itemLabel } from "@/lib/notifications";
import { canSeeItem, loadItem } from "./items";
import { loadUserNames } from "./user-names";

/** A peek the viewer may see, or the no-access sentinel. */
export type ItemPeek =
  | {
      access: "ok";
      ref: ItemRef;
      teamId: string;
      teamName: string;
      title: string;
      snippet: string | null;
      href: string;
    }
  | { access: "none" };

/** The sentinel: missing and forbidden look the same (no existence leak). */
export const NO_ACCESS: ItemPeek = { access: "none" };

async function teamNames(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const snaps = await db.getAll(...unique.map((id) => db.collection("teams").doc(id)));
  for (const s of snaps) {
    if (s.exists) out.set(s.id, String(s.data()?.name ?? "Team"));
  }
  return out;
}

/** Title + snippet of `ref` for `viewer`, through `canSee`. */
export async function peekItem(
  db: Firestore,
  ref: ItemRef,
  viewer: Viewer,
): Promise<ItemPeek> {
  if (!isItemType(ref?.type) || typeof ref.id !== "string" || !ref.id) return NO_ACCESS;
  const item = await loadItem(db, ref);
  if (!item || !canSeeItem(item, viewer)) return NO_ACCESS;
  const { title, snippet } = itemLabel(item.ref.type, item.data);
  const names = await teamNames(db, [item.teamId]);
  return {
    access: "ok",
    ref: item.ref,
    teamId: item.teamId,
    teamName: names.get(item.teamId) ?? "Team",
    title,
    snippet,
    href: linkFor(item.ref, item.teamId),
  };
}

/** What the hub shows for one row. Item fields are null when access is denied. */
export type NotificationLabel = {
  actorName: string;
  peek: ItemPeek;
};

/**
 * Labels for many of the viewer's rows at once: actor names (a person's
 * name is not item data) and each item's peek, each item loaded once.
 * Rows that are not the viewer's own are skipped.
 */
export async function labelNotifications(
  db: Firestore,
  viewer: Viewer,
  rowIds: readonly string[],
): Promise<Record<string, NotificationLabel>> {
  const ids = [...new Set(rowIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return {};
  const snaps = await db.getAll(...ids.map((id) => db.collection("notifications").doc(id)));
  const rows = snaps
    .filter((s) => s.exists && s.data()?.user_id === viewer.uid)
    .map((s) => ({ id: s.id, data: s.data() ?? {} }));

  const actorNames = await loadUserNames(
    db,
    rows.map((r) => String(r.data.actor_id ?? "")),
  );
  const peeks = new Map<string, ItemPeek>();
  for (const r of rows) {
    const key = `${r.data.entity_type}/${r.data.entity_id}`;
    if (peeks.has(key)) continue;
    peeks.set(
      key,
      await peekItem(
        db,
        { type: r.data.entity_type, id: String(r.data.entity_id ?? "") } as ItemRef,
        viewer,
      ),
    );
  }
  const out: Record<string, NotificationLabel> = {};
  for (const r of rows) {
    out[r.id] = {
      actorName: actorNames.get(String(r.data.actor_id ?? "")) ?? "Someone",
      peek: peeks.get(`${r.data.entity_type}/${r.data.entity_id}`) ?? NO_ACCESS,
    };
  }
  return out;
}
