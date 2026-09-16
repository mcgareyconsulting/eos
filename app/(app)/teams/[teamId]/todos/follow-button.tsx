"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTodoFollowing } from "./actions";

/**
 * Follow / Unfollow toggle for a to-do.
 *
 * Following means in-app notifications for comments, completion and edits
 * (lib/notifications.ts). The creator and owner follow automatically; this
 * is how anyone else opts in, and how anyone opts out. Optimistic so the
 * label flips on click rather than after the round trip.
 */
export function FollowButton({
  teamId,
  todoId,
  following,
  followerCount,
  className,
}: {
  teamId: string;
  todoId: string;
  following: boolean;
  followerCount: number;
  className?: string;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(
    following,
    (_state, next: boolean) => next,
  );

  function toggle() {
    const next = !optimistic;
    start(async () => {
      setOptimistic(next);
      try {
        setError(null);
        await setTodoFollowing(teamId, todoId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // Count shown reflects the click before the server confirms it.
  const count = Math.max(
    0,
    followerCount + (optimistic === following ? 0 : optimistic ? 1 : -1),
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={optimistic}
        title={
          optimistic
            ? "Stop getting notified about this to-do"
            : "Get notified about comments and updates on this to-do"
        }
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
          optimistic
            ? "border-hpb-blue/30 bg-hpb-blue/10 text-hpb-blue hover:bg-hpb-blue/15 dark:border-hpb-gold/30 dark:bg-hpb-gold/10 dark:text-hpb-gold dark:hover:bg-hpb-gold/15"
            : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
        )}
      >
        {optimistic ? (
          <BellOff className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Bell className="h-3.5 w-3.5" aria-hidden />
        )}
        {optimistic ? "Following" : "Follow"}
      </button>
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {count === 1 ? "1 follower" : `${count} followers`}
      </span>
      {error && (
        <span className="text-[11px] text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
