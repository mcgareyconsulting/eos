"use client";

import { useState } from "react";
import { dueDateShort, formatDateOnly } from "@/lib/dates";
import { dueToneClass } from "@/lib/due";
import { cn } from "@/lib/utils";
import { TodoCheckbox } from "./todo-row";
import { Eyebrow } from "@/components/ui/text";
import { useAuthUid } from "@/lib/firebase/use-collection";
import { MilestoneExpansion } from "../rocks/milestone-expansion";

export type MilestoneTodoItem = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  rock_title: string;
  /** Rich text, shown read-only when the row is expanded. Left out, the
   *  expansion reads it live from the milestone's doc. */
  description?: string | null;
};

type Member = { user_id: string; full_name: string };

// Shares TodoListRow's row chrome (padding, checkbox gutter, title type, date
// column, click-to-expand) so the two board columns read as one table split in
// half. The parent rock is the expansion's payload: it repeats across every
// milestone of the same rock, so it earns a detail line, not a row subtitle.
//
// The expansion also carries the milestone itself — its description and
// activity feed (MilestoneExpansion, the same panel the rock modals open).
// It is self-contained: the viewer falls back to the signed-in uid and the
// description to a live read, so a list need not pass either. Every row here
// is a milestone the viewer can see (the board's listeners and the L10's
// query are gated by the to-do read rule, which mirrors
// milestoneAccess.canSee), and seeing a milestone is what lets a person
// comment on it, so the feed's + Comment is always on.
export function MilestoneTodoRow({
  teamId,
  milestone,
  ownerName,
  /** Owner cards already name the owner — don't repeat it in the detail. */
  hideOwner = false,
  userId,
  members,
}: {
  teamId: string;
  milestone: MilestoneTodoItem;
  ownerName: string;
  hideOwner?: boolean;
  /** The viewer; defaults to the signed-in user. */
  userId?: string;
  /** Roster for naming comment authors. */
  members?: Member[];
}) {
  const [expanded, setExpanded] = useState(false);
  const authUid = useAuthUid();
  // The feed names the viewer "You"; it waits for client auth either way.
  const viewerId = userId ?? authUid ?? null;

  return (
    <div className="group px-4 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <TodoCheckbox
            teamId={teamId}
            todoId={milestone.id}
            completed={milestone.completed}
            appearance="milestone"
            guardDraft
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="-mx-1 min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {milestone.title}
          </span>
        </button>

        <div
          className={cn(
            // Matches TodoListRow's due column — see the note there.
            "w-14 shrink-0 pt-1 text-right text-xs font-semibold tabular-nums",
            dueToneClass(milestone.due_date, milestone.completed),
          )}
        >
          {dueDateShort(milestone.due_date, milestone.completed)}
        </div>
      </div>

      {expanded && (
        <div className="ml-7 mt-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div className="col-span-2">
              <Eyebrow as="dt">Rock</Eyebrow>
              {/* Full title, unwrapped — the row has no room for it. */}
              <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                {milestone.rock_title}
              </dd>
            </div>
            {!hideOwner && (
              <div>
                <Eyebrow as="dt">Owner</Eyebrow>
                <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                  {ownerName}
                </dd>
              </div>
            )}
            <div>
              <Eyebrow as="dt">Due</Eyebrow>
              <dd className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">
                {milestone.due_date ? formatDateOnly(milestone.due_date) : "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}
      {viewerId ? (
        <MilestoneExpansion
          open={expanded}
          draftKey={milestone.id}
          teamId={teamId}
          userId={viewerId}
          members={members}
          milestoneId={milestone.id}
          description={milestone.description}
          className="ml-7 border-l border-zinc-200 pb-1 pl-4 pt-3 dark:border-zinc-800"
        />
      ) : null}
    </div>
  );
}
