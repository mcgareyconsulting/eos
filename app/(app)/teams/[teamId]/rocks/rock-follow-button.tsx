"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { setFollowing } from "@/app/(app)/teams/[teamId]/follow/actions";

/**
 * Follow / Unfollow toggle for a rock — the metric FollowButton pattern over
 * the generic `setFollowing` action. Following means a notification on a
 * comment, a status change, a completed milestone, or a change to the owner
 * or due date (spec §5.3). Only rendered where the viewer sees the full rock.
 */
export function RockFollowButton({
  teamId,
  rockId,
  following,
  followerCount,
  locked = false,
}: {
  teamId: string;
  rockId: string;
  following: boolean;
  followerCount: number;
  /** The owner or current assigner: always following, cannot stop. */
  locked?: boolean;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(
    following,
    (_state, next: boolean) => next,
  );

  function toggle() {
    if (locked) return;
    const next = !optimistic;
    start(async () => {
      setOptimistic(next);
      try {
        setError(null);
        await setFollowing({ type: "rock", id: rockId }, teamId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const count = Math.max(
    0,
    followerCount + (optimistic === following ? 0 : optimistic ? 1 : -1),
  );

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={optimistic}
        disabled={locked}
        title={
          locked
            ? "The owner and the person who assigned it always follow this rock"
            : optimistic
              ? "Stop getting notified about this rock"
              : "Get notified when a comment, status change, completed milestone, or owner or due date change"
        }
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-80",
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
