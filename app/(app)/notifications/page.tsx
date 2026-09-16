import { requireFirebaseUser } from "@/lib/firebase/auth";
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
 * Rows are written by server actions when a to-do you follow is commented
 * on, completed, edited or assigned to you, and when someone @mentions you
 * in a to-do comment (lib/notifications.ts). Nothing here is email, and
 * nothing here is team-scoped: it is *your* inbox across every team.
 *
 * Same shape as the To-Dos tab: this server pass paints the first frame and
 * `NotificationsHub` holds the realtime subscription, so a row that lands
 * while the page is open appears without a refresh.
 */
export default async function NotificationsPage() {
  const { uid, db } = await requireFirebaseUser();

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
      team_name: String(n.team_name ?? "Team"),
      entity_type: "todo",
      entity_id: String(n.entity_id ?? ""),
      entity_title: String(n.entity_title ?? ""),
      kind: n.kind,
      actor_id: String(n.actor_id ?? ""),
      actor_name: String(n.actor_name ?? "Someone"),
      detail: (n.detail as string | null) ?? null,
      created_at: toMillis(n.created_at),
      read_at: toMillis(n.read_at),
      archived_at: toMillis(n.archived_at),
    };
  });

  return <NotificationsHub userId={uid} initial={initial} />;
}
