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
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  AtSign,
  Bell,
  BellPlus,
  CheckCheck,
  CheckCircle2,
  MessageSquare,
  Pencil,
  RotateCcw,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  notificationColumn,
  notificationHref,
  notificationTabLabel,
  notificationVerb,
  type NotificationEntityType,
  type NotificationKind,
} from "@/lib/notifications";
import { EmptyState } from "@/components/empty-state";
import { LocalTime } from "@/components/local-time";
import { entityHeaderButtonClass } from "@/components/entity-page-header";
import { EntityViewToggle } from "@/components/entity-view-tabs";
import { cn } from "@/lib/utils";
import {
  archiveNotification,
  archiveReadNotifications,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  restoreNotification,
} from "./actions";
import { TodoPeekModal } from "./todo-peek-modal";
import { IssuePeekModal } from "./issue-peek-modal";

type MaybeTimestamp = { toMillis: () => number } | number | null | undefined;

/** A row as the hub renders it: server projection or live snapshot. */
export type NotificationRow = {
  id: string;
  team_id: string;
  team_name: string;
  entity_type: NotificationEntityType;
  entity_id: string;
  entity_title: string;
  kind: NotificationKind;
  actor_id: string;
  actor_name: string;
  detail: string | null;
  created_at: MaybeTimestamp;
  read_at: MaybeTimestamp;
  /** Absent on rows older than the Archived tab — treated as not archived. */
  archived_at?: MaybeTimestamp;
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
  dropped: XCircle,
  moved: ArrowLeftRight,
  updated: Pencil,
  assigned: UserPlus,
  following: BellPlus,
};

const KIND_TONE: Record<NotificationKind, string> = {
  comment: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  mention: "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
  completed: "bg-hpb-green/10 text-hpb-green",
  reopened: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  dropped: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  moved: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  updated: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  assigned: "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
  following: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
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

  // Inbox / Archived, the same split to-dos use. Read rows stay in the
  // inbox, just quieter; a row moves to Archived only by its own ✕ or by
  // "Archive read", and is deleted only from there. Read/unread is its own
  // axis — archiving never touches it.
  const [showArchived, setShowArchived] = useState(false);
  const inbox = sorted.filter((n) => n.archived_at == null);
  const archived = sorted.filter((n) => n.archived_at != null);
  const shown = showArchived ? archived : inbox;
  const unread = inbox.filter((n) => n.read_at == null);
  const read = inbox.length - unread.length;
  // Two columns: ambient activity on to-dos and issues you own or follow,
  // and the rows that name you.
  const activity = shown.filter((n) => notificationColumn(n) === "activity");
  const mentions = shown.filter((n) => notificationColumn(n) === "mentions");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The to-do or issue a clicked row opens in place — see the peek modals.
  const [peek, setPeek] = useState<NotificationRow | null>(null);

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

  function archiveRead() {
    start(async () => {
      try {
        setError(null);
        await archiveReadNotifications();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="max-w-6xl space-y-6">
      <header className="flex h-10 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            Notifications
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!showArchived && (
            <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
              {unread.length === 0
                ? "all read"
                : `${unread.length} unread`}
            </span>
          )}
          <EntityViewToggle
            showArchived={showArchived}
            onChange={setShowArchived}
            activeCount={inbox.length}
            archivedCount={archived.length}
          />
          {!showArchived && (
            <>
              <button
                type="button"
                onClick={markAll}
                disabled={pending || unread.length === 0}
                className={cn(entityHeaderButtonClass, "disabled:opacity-40")}
              >
                <CheckCheck className="h-4 w-4" aria-hidden />
                Mark all read
              </button>
              <button
                type="button"
                onClick={archiveRead}
                disabled={pending || read === 0}
                title="Move every read notification to Archived"
                className={cn(entityHeaderButtonClass, "disabled:opacity-40")}
              >
                <Archive className="h-4 w-4" aria-hidden />
                Archive read
              </button>
            </>
          )}
        </div>
      </header>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Comments, completions, solves and edits on to-dos and issues you own
        or follow on the left; anywhere you&apos;re @mentioned on the right.
        You follow what you create, own or were added to; use Follow on
        anything else to opt in. Nothing lands here for what happened in an
        L10 you were in. Click a row to open it here. Rows stay in the inbox
        until you archive them — read ones just go quiet — and stay findable
        on Archived until deleted from there.
      </p>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <HubColumn
          title="Owned & following"
          rows={activity}
          onOpen={setPeek}
          emptyTitle={showArchived ? "Nothing archived" : "Nothing here"}
          emptyHint={
            showArchived
              ? "Rows you archive from the inbox land here."
              : "When someone comments on, completes, solves or reassigns a to-do or issue you own or follow, it lands here."
          }
        />
        <HubColumn
          title="Mentions"
          icon={AtSign}
          rows={mentions}
          onOpen={setPeek}
          emptyTitle={showArchived ? "No archived mentions" : "No mentions"}
          emptyHint={
            showArchived
              ? "Mentions you archive from the inbox land here."
              : "When someone @mentions you in a to-do or issue comment, it lands here."
          }
        />
      </div>

      {peek && peek.entity_type === "issue" ? (
        <IssuePeekModal n={peek} userId={userId} onClose={() => setPeek(null)} />
      ) : peek ? (
        <TodoPeekModal n={peek} userId={userId} onClose={() => setPeek(null)} />
      ) : null}

      {sorted.length >= HUB_LIMIT && (
        <p className="text-xs text-zinc-500">
          Showing the latest {HUB_LIMIT}.
        </p>
      )}
    </div>
  );
}

function HubColumn({
  title,
  icon: Icon = Bell,
  rows,
  onOpen,
  emptyTitle,
  emptyHint,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  rows: NotificationRow[];
  onOpen: (n: NotificationRow) => void;
  emptyTitle: string;
  emptyHint: string;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
        {title}{" "}
        <span className="font-bold text-zinc-400">({rows.length})</span>
      </h2>
      <div className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {rows.length === 0 ? (
          <EmptyState icon={Icon} title={emptyTitle} hint={emptyHint} />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((n) => (
              <NotificationItem key={n.id} n={n} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NotificationItem({
  n,
  onOpen,
}: {
  n: NotificationRow;
  onOpen: (n: NotificationRow) => void;
}) {
  const [, start] = useTransition();
  const Icon = KIND_ICON[n.kind] ?? Bell;
  const tone = KIND_TONE[n.kind] ?? KIND_TONE.comment;
  const unread = n.read_at == null;
  const whenMs = tsMs(n.created_at);

  // Mark read; the listener repaints the row.
  const markRead = () => {
    if (!unread) return;
    start(async () => {
      try {
        await markNotificationRead(n.id);
      } catch (e) {
        console.error("[notifications] mark read failed:", e);
      }
    });
  };

  // Open in place; the read mark rides along.
  const open = () => {
    markRead();
    onOpen(n);
  };

  // Row moves: the listener repaints on commit. Archive/restore leave
  // read_at alone; delete is only offered once a row is archived.
  const archived = n.archived_at != null;
  const run = (label: string, fn: () => Promise<void>) => () => {
    start(async () => {
      try {
        await fn();
      } catch (e) {
        console.error(`[notifications] ${label} failed:`, e);
      }
    });
  };
  const archive = run("archive", () => archiveNotification(n.id));
  const restore = run("restore", () => restoreNotification(n.id));
  const destroy = run("delete", () => deleteNotification(n.id));
  const hoverControl =
    "flex h-5 w-5 items-center justify-center rounded text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

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
        <button
          type="button"
          onClick={open}
          className={cn(
            "block w-full text-left text-sm hover:underline",
            unread
              ? "font-medium text-zinc-900 dark:text-zinc-100"
              : "text-zinc-600 dark:text-zinc-400",
          )}
        >
          <span className="font-semibold">{n.actor_name}</span>{" "}
          {notificationVerb(n)}
        </button>
        {n.detail && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
            {n.detail}
          </p>
        )}
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-500">
          <Link
            href={notificationHref(n)}
            onClick={markRead}
            className="hover:underline"
            title={`Open on the ${notificationTabLabel(n.entity_type)} tab`}
          >
            {n.team_name}
          </Link>
          {" · "}
          <LocalTime ms={whenMs} options={WHEN} fallback="just now" />
        </p>
      </div>

      <div className="mt-1.5 flex shrink-0 items-center gap-0.5">
        {unread ? (
          <button
            type="button"
            onClick={markRead}
            title="Mark as read"
            aria-label="Mark as read"
            className="flex h-5 w-5 items-center justify-center rounded-full text-hpb-blue hover:bg-hpb-blue/10 dark:text-hpb-gold dark:hover:bg-hpb-gold/15"
          >
            <span className="h-2 w-2 rounded-full bg-current" />
          </button>
        ) : (
          <span className="h-5 w-5" aria-hidden />
        )}
        {archived ? (
          <>
            <button
              type="button"
              onClick={restore}
              title="Restore to inbox"
              aria-label="Restore to inbox"
              className={hoverControl}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={destroy}
              title="Delete permanently"
              aria-label="Delete permanently"
              className={cn(hoverControl, "hover:text-red-600 dark:hover:text-red-400")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={archive}
            title="Archive"
            aria-label="Archive"
            className={hoverControl}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}
