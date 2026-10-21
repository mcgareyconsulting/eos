"use client";

import { formatDateOnly } from "@/lib/dates";
import { normalizeDescription } from "@/lib/csv-import";
import { effectiveFollowers, isLockedFollower } from "@/lib/follow";
import { RichText } from "@/components/rich-text";
import { Eyebrow } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { FollowButton } from "./follow-button";
import type { TodoListItem } from "./todo-list-row";

/**
 * A to-do read, not edited: description, owner / due / visibility, and the
 * Follow control. What the row's inline expansion used to show above its
 * comments (T4 moved those into the detail modal's ActivityFeed). Used by
 * the detail modal when the viewer can't edit (an off-team assignee, an
 * archived to-do) and by the notification peek.
 */
export function TodoDetails({
  teamId,
  todo,
  ownerName,
  userId,
  className,
}: {
  teamId: string;
  todo: TodoListItem;
  ownerName: string;
  userId: string;
  className?: string;
}) {
  // Restore label/body breaks lost in ninety xlsx exports (e.g. "Analytical"
  // glued onto the paragraph) so whitespace-pre-wrap can render them.
  const description = normalizeDescription(todo.description);
  // Owner + assigner always follow and cannot unfollow (lib/follow.ts).
  const followerIds = effectiveFollowers("todo", todo);

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Description
        </h4>
        {description.length > 0 ? (
          <RichText
            value={description}
            className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
          />
        ) : (
          <p className="text-xs italic text-zinc-400">No description.</p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div>
          <Eyebrow as="dt">Owner</Eyebrow>
          <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
            {ownerName}
          </dd>
        </div>
        <div>
          <Eyebrow as="dt">Due</Eyebrow>
          <dd className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">
            {todo.due_date ? formatDateOnly(todo.due_date) : "—"}
          </dd>
        </div>
        {todo.visibility === "private" && (
          <div>
            <Eyebrow as="dt">Visibility</Eyebrow>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
              Private
            </dd>
          </div>
        )}
      </dl>

      {/* A private to-do is its creator's and owner's alone, and both are
          locked followers, so no follow control. */}
      {todo.visibility !== "private" && (
        <FollowButton
          teamId={teamId}
          todoId={todo.id}
          following={followerIds.includes(userId)}
          locked={isLockedFollower("todo", todo, userId)}
          followerCount={followerIds.length}
          className="pt-1"
        />
      )}
    </div>
  );
}
