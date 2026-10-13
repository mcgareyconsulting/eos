"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { normalizeDescription } from "@/lib/csv-import";
import { canChangeTodoVisibility } from "@/lib/todo-access";
import { updateTodoMeta } from "./actions";
import { Button } from "@/components/ui/button";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalFooter,
  useDiscardGuard,
} from "@/components/ui/modal";
import { DetailShell } from "@/components/detail-shell";
import { ActivityFeed } from "@/components/activity-feed";
import { WeeklyFocusPill } from "@/components/weekly-focus-pill";
import { TodoFormFields, type Member } from "./todo-form-fields";
import { TodoDetails } from "./todo-details";
import type { TodoListItem } from "./todo-list-row";

/** Every field the form owns, in one shape — see draftChanged. */
type TodoDraft = {
  title: string;
  description: string;
  ownerId: string;
  due: string;
  visibility: "team" | "private";
  weeklyFocus: boolean;
  /** Current followers; the owner is implied and re-added by the server. */
  followerIds: string[];
};

/** The values the form opens with: the to-do's own. */
function draftFrom(todo: TodoListItem): TodoDraft {
  return {
    title: todo.title,
    description: normalizeDescription(todo.description),
    ownerId: todo.owner_id ?? "",
    due: todo.due_date ?? "",
    visibility: todo.visibility,
    weeklyFocus: !!todo.weekly_focus,
    followerIds: todo.follower_ids ?? [],
  };
}

/**
 * A to-do opened from its row (title or pencil): the T4 detail dialog.
 *
 * Two columns on the shared `DetailShell`: the form on the left, the
 * to-do's `ActivityFeed` on the right — its comments and its own activity
 * trace in one newest-first timeline, with + Comment folded at the top.
 * It replaced the form-only Edit dialog and opens from the row's pencil;
 * the row's title still expands it inline (details + the same feed). Add
 * to-do stays a one-column form, since a to-do that doesn't exist yet has
 * no history.
 *
 * `readOnly` is for a viewer who may not edit (an off-team assignee, an
 * archived to-do): the left column shows the to-do instead of the form,
 * and the feed still lets them comment, as the expansion did.
 *
 * Closing goes through one discard guard covering both columns: unsaved
 * form edits and an unsent comment each ask first.
 */
export function EditTodoModal({
  teamId,
  todo,
  members,
  currentUserId,
  ownerName,
  open,
  onClose,
  readOnly = false,
  showVisibility = true,
}: {
  teamId: string;
  todo: TodoListItem;
  members: Member[];
  /** The signed-in user — labelled "You" in the follower picker. */
  currentUserId: string;
  /** The owner's display name, for the read-only view. */
  ownerName: string;
  open: boolean;
  onClose: () => void;
  readOnly?: boolean;
  /**
   * False when opened from the L10: the to-do is a team one (private
   * to-dos never show there), and flipping it to Private mid-meeting would
   * pull it off the screen everyone is looking at. Same rule as Add from a
   * meeting (add-todo-modal.tsx).
   */
  showVisibility?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(
    normalizeDescription(todo.description),
  );
  const [ownerId, setOwnerId] = useState(todo.owner_id ?? "");
  const [due, setDue] = useState(todo.due_date ?? "");
  const [visibility, setVisibility] = useState<"team" | "private">(
    todo.visibility,
  );
  const [weeklyFocus, setWeeklyFocus] = useState(!!todo.weekly_focus);
  const [followerIds, setFollowerIds] = useState<string[]>(
    todo.follower_ids ?? [],
  );
  // What the fields held when the dialog opened. Seeded alongside them below,
  // so an edit form that opens full of the to-do's own data is not "changed".
  const [opened, setOpened] = useState<TodoDraft>(() => draftFrom(todo));
  // The feed's comment composer holds unsent text (ActivityFeed onDraftChange).
  const [commentDraft, setCommentDraft] = useState(false);

  function hydrate(draft: TodoDraft) {
    setTitle(draft.title);
    setDescription(draft.description);
    setOwnerId(draft.ownerId);
    setDue(draft.due);
    setVisibility(draft.visibility);
    setWeeklyFocus(draft.weeklyFocus);
    setFollowerIds(draft.followerIds);
    setOpened(draft);
    setError(null);
  }

  // Seed the form when the dialog opens, and again if the to-do it is editing
  // is swapped while open. Render-time (not in an effect) so the fields are
  // right on the same paint the dialog appears. Keyed on the id, not the
  // object: the L10 rebuilds each row's item on every live snapshot, and a
  // fresh object must not wipe what is being typed.
  const seedKey = open ? todo.id : null;
  const [seededFrom, setSeededFrom] = useState<string | null>(seedKey);
  if (seedKey !== seededFrom) {
    setSeededFrom(seedKey);
    if (seedKey) hydrate(draftFrom(todo));
  }

  const formDirty =
    !readOnly &&
    draftChanged(
      { title, description, ownerId, due, visibility, weeklyFocus, followerIds },
      opened,
    );

  function close() {
    setCommentDraft(false);
    onClose();
  }

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(formDirty || commentDraft, close);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", title);
    fd.set("description", description);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    // With the control hidden (the L10) the to-do keeps the visibility it
    // has; nothing on this surface can change it.
    fd.set("visibility", showVisibility ? visibility : todo.visibility);
    if (weeklyFocus) fd.set("weekly_focus", "on");
    // The picker's list is authoritative when present; the flag tells the
    // server so an older form without it never wipes the followers.
    fd.set("followers_edited", "on");
    for (const id of followerIds) fd.append("follower_ids", id);
    start(async () => {
      try {
        setError(null);
        await updateTodoMeta(teamId, todo.id, fd);
        close();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Only an unsent comment: the same wording as the other detail dialogs
  // (rock detail). Form edits, with or without a comment: the form's own.
  const discard = !formDirty
    ? {
        title: "Discard your comment?",
        discardLabel: "Discard comment",
        message: "Your comment hasn't been posted. Close now and it's gone.",
      }
    : {
        title: undefined,
        discardLabel: undefined,
        message: commentDraft
          ? "Your edits to this to-do and your comment haven't been saved. Close now and they're gone."
          : "Your edits to this to-do haven't been saved. Close now and they're gone.",
      };

  return (
    <>
      {open && (
        // Portalled (DetailShell's default): it paints above the row it
        // opened from, whose action cluster fades on hover, and above the
        // live L10's rail and pills.
        <DetailShell
          ariaLabel={readOnly ? "To-do" : "Edit to-do"}
          onClose={guard.requestClose}
          // Escape belongs to the discard confirm while it is up.
          dismissible={!guard.asking}
          aside={
            <ActivityFeed
              teamId={teamId}
              entityType="todo"
              entityId={todo.id}
              userId={currentUserId}
              members={members}
              onDraftChange={setCommentDraft}
            />
          }
        >
          {readOnly ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {todo.title}
                  {todo.weekly_focus && <WeeklyFocusPill className="ml-1.5" />}
                  {todo.visibility === "private" && (
                    <span
                      className="ml-1.5 inline-flex translate-y-px items-center text-zinc-400"
                      title="Private — only its creator, its owner and admins can see it"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span className="sr-only">Private</span>
                    </span>
                  )}
                </h2>
                {todo.archived && (
                  <p className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    Closed {todo.closed_on ?? "—"}
                  </p>
                )}
              </div>
              <TodoDetails
                teamId={teamId}
                todo={todo}
                ownerName={ownerName}
                userId={currentUserId}
              />
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <h2 className="text-base font-semibold tracking-tight">
                Edit to-do
              </h2>
              <TodoFormFields
                teamId={teamId}
                members={members}
                title={title}
                onTitleChange={setTitle}
                description={description}
                onDescriptionChange={setDescription}
                ownerId={ownerId}
                onOwnerChange={setOwnerId}
                due={due}
                onDueChange={setDue}
                showVisibility={showVisibility}
                visibility={visibility}
                onVisibilityChange={setVisibility}
                canPublish={canChangeTodoVisibility(
                  todo,
                  { uid: currentUserId },
                  "team",
                )}
                viewerId={currentUserId}
                creatorId={todo.created_by ?? null}
                weeklyFocus={weeklyFocus}
                onWeeklyFocusChange={setWeeklyFocus}
                followers={{
                  currentUserId,
                  creatorFollows: false,
                  value: followerIds,
                  onChange: setFollowerIds,
                }}
                error={error}
              />

              <ModalFooter>
                <Button variant="ghost" onClick={guard.requestClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !title.trim()}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </ModalFooter>
            </form>
          )}
        </DetailShell>
      )}

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        title={discard.title}
        discardLabel={discard.discardLabel}
        message={discard.message}
      />
    </>
  );
}
