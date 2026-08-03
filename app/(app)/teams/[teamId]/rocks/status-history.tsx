"use client";

import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  STATUS_STYLES,
  isRockStatus,
  type RockStatus,
} from "./status";

// Plain-data history entry (server serializes Timestamps → millis).
export type StatusUpdateSerialized = {
  id: string;
  status: string;
  comment: string | null;
  user_id: string | null;
  /** Epoch millis, or null if the server timestamp hasn't resolved yet. */
  created_at_ms: number | null;
  author_name: string;
};

export function StatusHistoryList({
  updates,
  className,
}: {
  updates: StatusUpdateSerialized[];
  className?: string;
}) {
  if (updates.length === 0) {
    return (
      <p className={cn("text-xs italic text-zinc-400", className)}>
        No status comments yet. Notes from status changes appear here after
        you save.
      </p>
    );
  }

  return (
    <ul className={cn("space-y-2", className)}>
      {updates.map((u) => {
        const status: RockStatus | null = isRockStatus(u.status)
          ? u.status
          : null;
        const when =
          u.created_at_ms != null
            ? new Date(u.created_at_ms).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "—";
        return (
          <li
            key={u.id}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              {status && (
                <span
                  className={cn(
                    "inline-flex h-5 items-center justify-center rounded-full px-2 text-[10px] font-medium ring-1 ring-inset",
                    STATUS_STYLES[status],
                  )}
                >
                  {STATUS_LABELS[status]}
                </span>
              )}
              <span className="text-zinc-500">
                {u.author_name} · {when}
              </span>
            </div>
            {u.comment ? (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {u.comment}
              </p>
            ) : (
              <p className="mt-1 italic text-zinc-400">No comment</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One-line teaser of the latest commented status update (row collapse). */
export function LatestStatusComment({
  updates,
}: {
  updates: StatusUpdateSerialized[];
}) {
  const withComment = updates.find((u) => u.comment && u.comment.trim());
  if (!withComment?.comment) return null;
  return (
    <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">
        Status note:
      </span>{" "}
      {withComment.comment}
    </p>
  );
}
