"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useAuthUid, useCollection } from "@/lib/firebase/use-collection";
import { cn } from "@/lib/utils";

/**
 * Sidebar link to /notifications with a live unread count.
 *
 * `initialUnread` is the server's count so the badge is right on first
 * paint; the listener replaces it once client auth is ready. Two equality
 * filters need no composite index. Rules only allow this query with the
 * caller's own uid in it, which is why it waits on `useAuthUid`.
 */
export function NotificationsNavLink({
  initialUnread = 0,
}: {
  initialUnread?: number;
}) {
  const pathname = usePathname() ?? "";
  const active = pathname === "/notifications";
  const uid = useAuthUid();
  const db = getClientDb();

  const q = useMemo(
    () =>
      uid
        ? fsQuery(
            collection(db, "notifications"),
            where("user_id", "==", uid),
            where("read_at", "==", null),
          )
        : null,
    [db, uid],
  );
  // Only the count matters; the rows are typed minimally on purpose.
  // Archived rows drop out here, not in the query: `archived_at` is absent
  // on rows older than the Archived tab, which `== null` would not match.
  const initial = useMemo(
    () => Array.from({ length: initialUnread }, (_, i) => ({ id: `ssr-${i}` })),
    [initialUnread],
  );
  const unread = useCollection<{ id: string; archived_at?: unknown }>(
    q,
    initial,
    "unread-count",
  ).filter((n) => n.archived_at == null).length;
  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <Link
      href="/notifications"
      title={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
      aria-label={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 group-data-[sidebar-collapsed]/shell:justify-center dark:text-zinc-300 dark:hover:bg-zinc-800",
        active && "bg-zinc-100 font-medium dark:bg-zinc-800",
      )}
    >
      <span className="relative shrink-0">
        <Bell className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
        {/* Collapsed rail: a dot, since there is no room for a number. */}
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 hidden h-2 w-2 rounded-full bg-hpb-blue ring-2 ring-white group-data-[sidebar-collapsed]/shell:block dark:bg-hpb-gold dark:ring-zinc-900"
            aria-hidden
          />
        )}
      </span>
      <span className="min-w-0 flex-1 group-data-[sidebar-collapsed]/shell:hidden">
        Notifications
      </span>
      {unread > 0 && (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hpb-blue px-1.5 text-[10px] font-semibold tabular-nums text-white group-data-[sidebar-collapsed]/shell:hidden dark:bg-hpb-gold dark:text-zinc-900">
          {badge}
        </span>
      )}
    </Link>
  );
}
