"use client";

import { useMemo } from "react";
import {
  collection,
  query as fsQuery,
  where,
  type Query,
} from "firebase/firestore";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  CheckCircle2,
  FileText,
  History,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  activityVerb,
  SYSTEM_ACTOR_ID,
  type ActivityKind,
} from "@/lib/activity";
import { LocalTime } from "@/components/local-time";
import { cn } from "@/lib/utils";

type MaybeTimestamp = { toMillis: () => number } | number | null | undefined;

type ActivityRow = {
  id: string;
  kind: ActivityKind;
  actor_id: string;
  actor_name: string;
  detail: string | null;
  created_at: MaybeTimestamp;
};

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
  ActivityKind,
  React.ComponentType<{ className?: string }>
> = {
  created: Plus,
  updated: Pencil,
  description: FileText,
  completed: CheckCircle2,
  reopened: RotateCcw,
  archived: Archive,
  restored: ArchiveRestore,
  weekly_focus_on: Star,
  weekly_focus_off: StarOff,
  followed: Bell,
  unfollowed: BellOff,
  followers_added: UserPlus,
  followers_removed: UserMinus,
  commented: MessageSquare,
  comment_deleted: Trash2,
};

const KIND_TONE: Partial<Record<ActivityKind, string>> = {
  created: "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
  completed: "bg-hpb-green/10 text-hpb-green",
  reopened: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  weekly_focus_on: "bg-hpb-gold/15 text-hpb-gold",
  commented: "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
};
const DEFAULT_TONE =
  "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * The activity trace for one to-do, newest first — every event the server
 * actions recorded (lib/activity.ts), live.
 *
 * The query mirrors the `entity_activity` rule: it always pins `visibility`,
 * and for a private to-do pins `owner_id` too, because the rule rejects a
 * list it cannot prove is readable. `visibility` / `ownerId` come from the
 * to-do as the caller currently sees it.
 */
export function EntityActivity({
  teamId,
  entityType,
  entityId,
  visibility,
  ownerId,
  userId,
  className,
}: {
  teamId: string;
  entityType: "todo";
  entityId: string;
  visibility: "team" | "private";
  ownerId: string | null;
  userId: string;
  className?: string;
}) {
  const db = getClientDb();
  const q = useMemo<Query | null>(() => {
    const base = [
      where("team_id", "==", teamId),
      where("entity_type", "==", entityType),
      where("entity_id", "==", entityId),
      where("visibility", "==", visibility),
    ];
    if (visibility === "private") {
      // Only the owner can read a private trace; anyone else gets nothing
      // rather than a rules error in the console.
      if (ownerId !== userId) return null;
      base.push(where("owner_id", "==", userId));
    }
    return fsQuery(collection(db, "entity_activity"), ...base);
  }, [db, teamId, entityType, entityId, visibility, ownerId, userId]);
  const rows = useCollection<ActivityRow>(q, [], "entity-activity");

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (tsMs(b.created_at) ?? Number.MAX_SAFE_INTEGER) -
          (tsMs(a.created_at) ?? Number.MAX_SAFE_INTEGER),
      ),
    [rows],
  );

  return (
    <section className={cn("space-y-3", className)} aria-label="Activity">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <History className="h-3.5 w-3.5" />
        Activity
        <span className="font-normal normal-case tracking-normal text-zinc-400">
          ({sorted.length})
        </span>
      </h3>

      {sorted.length === 0 ? (
        <p className="text-xs text-zinc-500">
          Nothing recorded yet. Edits, completions, archives, follows and
          comments from here on will show up in order.
        </p>
      ) : (
        <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-zinc-200 dark:before:bg-zinc-800">
          {sorted.map((r) => {
            const Icon = KIND_ICON[r.kind] ?? Pencil;
            const tone = KIND_TONE[r.kind] ?? DEFAULT_TONE;
            return (
              <li key={r.id} className="relative flex items-start gap-2.5">
                <span
                  className={cn(
                    "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-white dark:ring-zinc-900",
                    tone,
                  )}
                  aria-hidden
                >
                  <Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-xs text-zinc-800 dark:text-zinc-200">
                    {r.actor_id === SYSTEM_ACTOR_ID ? (
                      // A sweep, not a person — no name to bold.
                      <span className="font-semibold">
                        Archived automatically
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold">
                          {r.actor_id === userId ? "You" : r.actor_name}
                        </span>{" "}
                        {activityVerb(r.kind)}
                      </>
                    )}
                  </p>
                  {r.detail && (
                    <p className="mt-0.5 line-clamp-3 text-[11px] text-zinc-600 dark:text-zinc-400">
                      {r.detail}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    <LocalTime
                      ms={tsMs(r.created_at)}
                      options={WHEN}
                      fallback="just now"
                    />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
