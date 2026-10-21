"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Lock, Pencil, Star, Trash2 } from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { cn } from "@/lib/utils";
import { dueDateShort } from "@/lib/dates";
import { TODO_DUE_SOON_DAYS, dueToneClass } from "@/lib/due";
import { useTimeZone } from "@/components/time-zone-provider";
import { WeeklyFocusPill } from "@/components/weekly-focus-pill";
import { pendingArchiveLabel } from "@/lib/todos-archive";
import { TodoCheckbox } from "./todo-row";
import { ActivityFeed } from "@/components/activity-feed";
import { EditTodoModal } from "./edit-todo-modal";
import { TodoDetails } from "./todo-details";
import { deleteTodo, setTodoArchived, toggleWeeklyFocus } from "./actions";

export type TodoListItem = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  visibility: "team" | "private";
  /** Replaces the `**` title convention. */
  weekly_focus?: boolean;
  archived?: boolean;
  /** Local mm/dd/yyyy when archived (from archived_at). */
  closed_on?: string | null;
  /** Who gets notified about it — see lib/notifications.ts. */
  follower_ids?: string[] | null;
  /** Who made the current assignment (locked follower); legacy: created_by. */
  assigned_by?: string | null;
  created_by?: string | null;
};

type Member = { user_id: string; full_name: string };

// Click the title (or the pencil) to open the to-do: the two-column detail
// dialog (edit-todo-modal.tsx) with the form on the left and the
// ActivityFeed (comments + the activity trace) on the right (T4). This
// replaced an inline expansion that held the description, Follow, comments
// and the trace; the dialog covers all of it. Checkbox / star / archive /
// delete stay on the row.
export function TodoListRow({
  teamId,
  todo,
  ownerName,
  members,
  userId,
  /** Owner cards already name the owner — don't repeat it on every row. */
  hideOwner = false,
  /** Deep-linked from a notification: scroll into view and open the to-do. */
  focused = false,
  /**
   * False where the row already sits inside the to-do's own detail (the
   * notification peek): the title is plain text. The pencil still edits.
   */
  opensDetail = true,
  /**
   * Where the row is rendered. In the L10 the list already has a "Done"
   * divider, so the per-row archiving line is noise, and the timing it would
   * name is wrong anyway: everything closed by Finish goes then, not Monday.
   * The L10 also hides Visibility in the dialog: everything on it is a team
   * to-do, and flipping one to Private mid-meeting would pull it off the
   * screen (same rule as Add to-do from a meeting).
   */
  surface = "page",
  /**
   * "assignee": the viewer is the to-do's assignee from outside its team
   * (spec §3 shape A) — they complete, comment and follow, but the edit,
   * weekly-focus, archive and delete controls are the team's.
   */
  access = "full",
  /** "Assigned by <name> · <team>" — rows from another team (D1). */
  assignedPill,
}: {
  teamId: string;
  todo: TodoListItem;
  ownerName: string;
  members: Member[];
  userId: string;
  hideOwner?: boolean;
  focused?: boolean;
  /** The title expands the row (details + comments/activity). False where
   *  the row already sits inside a detail view (the notification peek). */
  opensDetail?: boolean;
  surface?: "page" | "meeting";
  access?: "full" | "assignee";
  assignedPill?: string | null;
}) {
  const manage = access === "full";
  const rootRef = useRef<HTMLDivElement>(null);

  // Clicking the title expands the row inline: the to-do's details, then
  // its comments and activity (one feed). A deep link arrives expanded.
  // The pencil opens the two-column edit dialog.
  const [expanded, setExpanded] = useState(opensDetail && focused);
  const [hasDraft, setHasDraft] = useState(false);
  function toggleExpanded() {
    if (
      expanded &&
      hasDraft &&
      !window.confirm("Discard your comment? It hasn't been posted.")
    )
      return;
    if (expanded) setHasDraft(false);
    setExpanded(!expanded);
  }
  const [detailOpen, setDetailOpen] = useState(false);
  const timeZone = useTimeZone();
  const now = new Date();
  function openDetail() {
    setDetailOpen(true);
  }
  function closeDetail() {
    setDetailOpen(false);
  }

  // One scroll, on arrival. `focused` only ever flips from the URL, and a
  // live re-render of the list must not yank the page back here.
  useEffect(() => {
    if (!focused) return;
    rootRef.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const remove = deleteTodo.bind(null, teamId, todo.id);
  const toggleArchive = setTodoArchived.bind(
    null,
    teamId,
    todo.id,
    !todo.archived,
  );
  const toggleFocus = toggleWeeklyFocus.bind(
    null,
    teamId,
    todo.id,
    !todo.weekly_focus,
  );
  // Active/L10: completed = checked box only (no strikethrough — stays readable).
  // Archived: no checkbox; "Closed On" date instead of heavy grayout.
  const archived = !!todo.archived;

  // Mid-week complete (not yet archived): gray row until Monday / Finish.
  const closedPending = !archived && todo.completed;

  // Who gets the edit pencil: the team's members on a live to-do. An
  // off-team assignee, and anyone on an archived one, read and comment
  // through the expansion instead.
  const canEdit = manage && !archived;
  const TitleTag = opensDetail ? "button" : "div";

  return (
    <div
      ref={rootRef}
      id={`todo-${todo.id}`}
      className={cn(
        "group px-4 py-2.5 text-sm",
        closedPending &&
          "bg-zinc-50/90 text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400",
        focused &&
          "ring-2 ring-inset ring-hpb-blue/40 dark:ring-hpb-gold/40",
      )}
    >
      <div className="flex items-start gap-3">
        {!archived && (
          <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <TodoCheckbox
              teamId={teamId}
              todoId={todo.id}
              completed={todo.completed}
              appearance="milestone"
            />
          </div>
        )}

        <TitleTag
          {...(opensDetail
            ? {
                type: "button" as const,
                onClick: toggleExpanded,
                "aria-expanded": expanded,
              }
            : {})}
          className={cn(
            "-mx-1 min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left",
            opensDetail && "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
          )}
        >
          <span
            className={cn(
              "font-medium text-zinc-900 dark:text-zinc-100",
              closedPending && "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {todo.title}
          </span>
          {todo.weekly_focus && <WeeklyFocusPill className="ml-1.5" />}
          {todo.visibility === "private" && (
            <span
              className="ml-1.5 inline-flex translate-y-px items-center text-zinc-400"
              title="Private — only its creator, its owner and admins can see it"
            >
              <Lock className="h-3 w-3" />
              <span className="sr-only">Private</span>
            </span>
          )}
          {assignedPill && (
            <span className="ml-1.5 inline-flex max-w-full translate-y-[-1px] items-center rounded-full bg-hpb-gold/15 px-2 py-0.5 align-middle text-[10.5px] font-medium text-hpb-brown dark:text-hpb-gold">
              <span className="truncate">{assignedPill}</span>
            </span>
          )}
          {archived && (
            <span className="mt-0.5 block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              Closed {todo.closed_on ?? "—"}
            </span>
          )}
          {closedPending && surface === "page" && (
            <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
              {pendingArchiveLabel(todo.visibility)}
            </span>
          )}
        </TitleTag>

        {!hideOwner && (
          <div className="w-28 shrink-0 pt-1 text-right text-xs text-zinc-600 dark:text-zinc-400">
            {ownerName}
          </div>
        )}
        <div
          className={cn(
            // pt-1, not pt-0.5: the row is `items-start` so a wrapped title
            // keeps this column on the first line, which means this box has to
            // centre itself against that line rather than inherit centring. The
            // title (py-0.5 + 20px line) and the icon buttons (p-1 + 16px icon)
            // are both 24px tall, centre 12; 12px text on 2px padding centres at
            // 10 and reads 2px high against every icon beside it.
            "w-14 shrink-0 pt-1 text-right text-xs font-semibold tabular-nums",
            archived
              ? "text-zinc-400 dark:text-zinc-500"
              : dueToneClass(
                  todo.due_date,
                  todo.completed,
                  now,
                  TODO_DUE_SOON_DAYS,
                  timeZone,
                ),
          )}
        >
          {dueDateShort(
            todo.due_date,
            todo.completed || archived,
            now,
            timeZone,
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {manage && !archived && (
            <form action={toggleFocus}>
              <button
                type="submit"
                aria-pressed={!!todo.weekly_focus}
                className={cn(
                  "rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  todo.weekly_focus
                    ? "text-hpb-gold"
                    : "text-zinc-300 opacity-0 hover:text-hpb-gold group-hover:opacity-100 dark:text-zinc-600",
                )}
                aria-label={
                  todo.weekly_focus
                    ? "Remove weekly focus"
                    : "Mark as weekly focus"
                }
                title={
                  todo.weekly_focus
                    ? "Remove weekly focus"
                    : "Mark as this week's focus"
                }
              >
                <Star
                  className="h-4 w-4"
                  fill={todo.weekly_focus ? "currentColor" : "none"}
                />
              </button>
            </form>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={openDetail}
              aria-haspopup="dialog"
              title="Edit to-do"
              aria-label="Edit to-do"
              className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {manage && (
          <form action={toggleArchive}>
            <button
              type="submit"
              className="rounded p-1 text-zinc-300 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={
                archived
                  ? "Restore to-do"
                  : todo.completed
                    ? "Archive to-do"
                    : "Close and archive to-do"
              }
              title={
                archived
                  ? "Restore to Active"
                  : !todo.completed
                    ? "Close it and archive now"
                    : surface === "meeting"
                      ? "Archive now (done to-dos archive when this meeting ends)"
                      : "Archive now (done items also archive on their own)"
              }
            >
              <Archive className="h-4 w-4" />
            </button>
          </form>
          )}
          {manage && !archived && (
            <ConfirmSubmitForm
              action={remove}
              confirmMessage="Delete this to-do? This can't be undone."
            >
              <button
                type="submit"
                className="rounded p-1 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
                aria-label="Delete to-do"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </ConfirmSubmitForm>
          )}
        </div>
      </div>

      {expanded && (
        <div
          className={cn(
            "mt-3 space-y-4 border-l border-zinc-200 pl-4 dark:border-zinc-800",
            archived ? "ml-1" : "ml-7",
          )}
        >
          <TodoDetails
            teamId={teamId}
            todo={todo}
            ownerName={ownerName}
            userId={userId}
          />
          <ActivityFeed
            teamId={teamId}
            entityType="todo"
            entityId={todo.id}
            userId={userId}
            members={members}
            onDraftChange={setHasDraft}
          />
        </div>
      )}

      <EditTodoModal
        teamId={teamId}
        todo={todo}
        members={members}
        currentUserId={userId}
        ownerName={ownerName}
        open={detailOpen}
        onClose={closeDetail}
        readOnly={!canEdit}
        showVisibility={surface !== "meeting"}
      />
    </div>
  );
}
