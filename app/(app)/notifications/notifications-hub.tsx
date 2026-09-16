"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  collection,
  limit,
  orderBy,
  query as fsQuery,
  where,
} from "firebase/firestore";
import {
  AtSign,
  Bell,
  CheckCheck,
  CheckCircle2,
  MessageSquare,
  Pencil,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  notificationHref,
  notificationVerb,
  type NotificationKind,
} from "@/lib/notifications";
import { EmptyState } from "@/components/empty-state";
import { LocalTime } from "@/components/local-time";
import {
  entityToggleIdleClass,
  entityToggleSelectedClass,
} from "@/components/entity-view-tabs";
import { entityHeaderButtonClass } from "@/components/entity-page-header";
import { cn } from "@/lib/utils";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

type MaybeTimestamp = { toMillis: () => number } | number | null | undefined;

/** A row as the hub renders it: server projection or live snapshot. */
export type NotificationRow = {
  id: string;
  team_id: string;
  team_name: string;
  entity_type: "todo";
  entity_id: string;
  entity_title: string;
  kind: NotificationKind;
  actor_id: string;
  actor_name: string;
  detail: string | null;
  created_at: MaybeTimestamp;
  read_at: MaybeTimestamp;
};

const HUB_LIMIT = 200;

function tsMs(t: MaybeTimestamp): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}

const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const KIND_ICON: Record<
  NotificationKind,
  React.ComponentType<{ className?: string }>
> = {
  comment: MessageSquare,
  mention: AtSign,
  completed: CheckCircle2,
  reopened: RotateCcw,
  updated: Pencil,
  assigned: UserPlus,
};

const KIND_TONE: Record<NotificationKind, string> = {
  comment: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  mention: "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
  completed: "bg-hpb-green/10 text-hpb-green",
  reopened: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  updated: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  assigned: "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
};

export function NotificationsHub({
  userId,
  initial,
}: {
  userId: string;
  initial: NotificationRow[];
}) {
  const db = getClientDb();
  const q = useMemo(
    () =>
      fsQuery(
        collection(db, "notifications"),
        where("user_id", "==", userId),
        orderBy("created_at", "desc"),
        limit(HUB_LIMIT),
      ),
    [db, userId],
  );
  const rows = useCollection<NotificationRow>(q, initial, "notifications");

  // The listener already orders newest-first; sort again so the server
  // projection (millis) and a row whose serverTimestamp is still pending
  // (null → treat as now) agree with it.
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (tsMs(b.created_at) ?? Number.MAX_SAFE_INTEGER) -
          (tsMs(a.created_at) ?? Number.MAX_SAFE_INTEGER),
      ),
    [rows],
  );

  const [view, setView] = useState<"unread" | "all">("unread");
  const unread = sorted.filter((n) => n.read_at == null);
  const shown = view === "unread" ? unread : sorted;

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markAll() {
    start(async () => {
      try {
        setError(null);
        await markAllNotificationsRead();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex h-10 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            Notifications
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div role="group" aria-label="Show" className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setView("unread")}
              aria-pressed={view === "unread"}
              className={cn(
                "min-w-[6.75rem]",
                view === "unread"
                  ? entityToggleSelectedClass
                  : entityToggleIdleClass,
              )}
            >
              Unread ({unread.length})
            </button>
            <button
              type="button"
              onClick={() => setView("all")}
              aria-pressed={view === "all"}
              className={cn(
                "min-w-[5.5rem]",
                view === "all"
                  ? entityToggleSelectedClass
                  : entityToggleIdleClass,
              )}
            >
              All ({sorted.length})
            </button>
          </div>
          <button
            type="button"
            onClick={markAll}
            disabled={pending || unread.length === 0}
            className={cn(entityHeaderButtonClass, "disabled:opacity-40")}
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
            Mark all read
          </button>
        </div>
      </header>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Comments, completions and edits on to-dos you follow, plus anywhere
        you&apos;re @mentioned. You follow a to-do you create or own; use
        Follow on any other to-do to opt in.
      </p>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <section className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {shown.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={
              view === "unread" ? "You're all caught up" : "Nothing here yet"
            }
            hint={
              view === "unread"
                ? "New activity on to-dos you follow will show up here."
                : "When someone comments on, completes or reassigns a to-do you follow — or mentions you — it lands here."
            }
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((n) => (
              <NotificationItem key={n.id} n={n} />
            ))}
          </ul>
        )}
      </section>

      {sorted.length >= HUB_LIMIT && (
        <p className="text-xs text-zinc-500">
          Showing the latest {HUB_LIMIT}.
        </p>
      )}
    </div>
  );
}

function NotificationItem({ n }: { n: NotificationRow }) {
  const [, start] = useTransition();
  const Icon = KIND_ICON[n.kind] ?? Bell;
  const tone = KIND_TONE[n.kind] ?? KIND_TONE.comment;
  const unread = n.read_at == null;
  const whenMs = tsMs(n.created_at);

  // Navigate now; the read mark rides along and the listener repaints.
  const open = () => {
    if (!unread) return;
    start(async () => {
      try {
        await markNotificationRead(n.id);
      } catch (e) {
        console.error("[notifications] mark read failed:", e);
      }
    });
  };

  return (
    <li
      className={cn(
        "group relative flex items-start gap-3 px-4 py-3",
        unread ? "bg-white dark:bg-zinc-900" : "bg-zinc-50/60 dark:bg-zinc-950/30",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          tone,
        )}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <Link
          href={notificationHref(n)}
          onClick={open}
          className="block text-sm text-zinc-800 hover:underline dark:text-zinc-200"
        >
          <span className="font-semibold">{n.actor_name}</span>{" "}
          {notificationVerb(n)}
        </Link>
        {n.detail && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
            {n.detail}
          </p>
        )}
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-500">
          {n.team_name}
          {" · "}
          <LocalTime ms={whenMs} options={WHEN} fallback="just now" />
        </p>
      </div>

      {unread ? (
        <button
          type="button"
          onClick={open}
          title="Mark as read"
          aria-label="Mark as read"
          className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-hpb-blue hover:bg-hpb-blue/10 dark:text-hpb-gold dark:hover:bg-hpb-gold/15"
        >
          <span className="h-2 w-2 rounded-full bg-current" />
        </button>
      ) : (
        <span className="mt-1.5 h-5 w-5 shrink-0" aria-hidden />
      )}
    </li>
  );
}
