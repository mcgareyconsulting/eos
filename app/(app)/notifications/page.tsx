import { requireFirebaseUser } from "@/lib/firebase/auth";
import { loadViewer } from "@/lib/firebase/items";
import { labelNotifications } from "@/lib/firebase/item-peek";
import { NotificationsHub, type NotificationRow } from "./notifications-hub";

/** Admin-SDK Timestamp → millis, so the value can cross the RSC boundary. */
function toMillis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : null;
}

/** Newest rows the hub paints on arrival; the live listener takes over.
 *  Kept equal to the listener's own limit in notifications-hub.tsx. */
const HUB_LIMIT = 200;

/**
 * Notifications hub — the one page where in-app notifications land.
 *
 * Rows are pointers (lib/notifications.ts NotificationDoc): kind, event,
 * item, actor, time. Titles are resolved here, at read time, through the
 * item's `canSee` (lib/firebase/item-peek.ts) — a row about an item the
 * viewer can no longer see says "You do not have access to this item."
 * Stored copies on rows from before P5 (entity_title, detail…) are ignored.
 *
 * Same shape as the To-Dos tab: this server pass paints the first frame and
 * `NotificationsHub` holds the realtime subscription, so a row that lands
 * while the page is open appears without a refresh.
 */
export default async function NotificationsPage() {
  const { uid, db, isAdmin } = await requireFirebaseUser();

  const snap = await db
    .collection("notifications")
    .where("user_id", "==", uid)
    .orderBy("created_at", "desc")
    .limit(HUB_LIMIT)
    .get();

  const initial: NotificationRow[] = snap.docs.map((d) => {
    const n = d.data();
    return {
      id: d.id,
      team_id: String(n.team_id ?? ""),
      entity_type: String(n.entity_type ?? "todo") as NotificationRow["entity_type"],
      entity_id: String(n.entity_id ?? ""),
      kind: n.kind,
      event: (n.event as NotificationRow["event"]) ?? null,
      actor_id: String(n.actor_id ?? ""),
      created_at: toMillis(n.created_at),
      read_at: toMillis(n.read_at),
      archived_at: toMillis(n.archived_at),
    };
  });

  const viewer = await loadViewer(db, uid, isAdmin);
  const labels = await labelNotifications(
    db,
    viewer,
    initial.map((r) => r.id),
  );

  return (
    <NotificationsHub userId={uid} initial={initial} initialLabels={labels} />
  );
}
