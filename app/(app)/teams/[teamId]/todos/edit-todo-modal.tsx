"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { normalizeDescription } from "@/lib/csv-import";
import { updateTodoMeta } from "./actions";
import { Button } from "@/components/ui/button";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalShell,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDiscardGuard,
} from "@/components/ui/modal";
import { TodoFormFields, type Member } from "./todo-form-fields";

type TodoForEdit = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  visibility: "team" | "private";
  weekly_focus?: boolean;
};

/** Every field the form owns, in one shape — see draftChanged. */
type TodoDraft = {
  title: string;
  description: string;
  ownerId: string;
  due: string;
  visibility: "team" | "private";
  weeklyFocus: boolean;
};

/** The values the form opens with: the to-do's own. */
function draftFrom(todo: TodoForEdit, members: Member[]): TodoDraft {
  return {
    title: todo.title,
    description: normalizeDescription(todo.description),
    ownerId: todo.owner_id ?? members[0]?.user_id ?? "",
    due: todo.due_date ?? "",
    visibility: todo.visibility,
    weeklyFocus: !!todo.weekly_focus,
  };
}

/**
 * Pencil in the to-do row → edit dialog.
 *
 * **Centered, not a right-hand drawer.** This was the only edit surface in the
 * app that slid in from the side, which made the to-do you were editing the
 * one thing the layout pushed off to the margin, and gave Add to-do and Edit
 * to-do — the same six fields, filled in twice — two different shapes. Same
 * `ModalShell` as Add to-do now, so the pair reads as one form in two modes.
 */
export function EditTodoModal({
  teamId,
  todo,
  members,
}: {
  teamId: string;
  todo: TodoForEdit;
  members: Member[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(
    normalizeDescription(todo.description),
  );
  const [ownerId, setOwnerId] = useState(
    todo.owner_id ?? members[0]?.user_id ?? "",
  );
  const [due, setDue] = useState(todo.due_date ?? "");
  const [visibility, setVisibility] = useState<"team" | "private">(
    todo.visibility,
  );
  const [weeklyFocus, setWeeklyFocus] = useState(!!todo.weekly_focus);
  // What the fields held when the dialog opened. Seeded alongside them below,
  // so an edit form that opens full of the to-do's own data is not "changed".
  const [opened, setOpened] = useState<TodoDraft>(() =>
    draftFrom(todo, members),
  );

  function hydrate(draft: TodoDraft) {
    setTitle(draft.title);
    setDescription(draft.description);
    setOwnerId(draft.ownerId);
    setDue(draft.due);
    setVisibility(draft.visibility);
    setWeeklyFocus(draft.weeklyFocus);
    setOpened(draft);
    setError(null);
  }

  // Seed the form when the dialog opens, and again if the to-do it is editing
  // is swapped while open. Render-time (not in an effect) so the fields are
  // right on the same paint the dialog appears.
  const seedSource = open ? todo : null;
  const [seededFrom, setSeededFrom] = useState<typeof seedSource>(seedSource);
  if (seedSource !== seededFrom) {
    setSeededFrom(seedSource);
    if (seedSource) hydrate(draftFrom(seedSource, members));
  }

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(
    draftChanged(
      { title, description, ownerId, due, visibility, weeklyFocus },
      opened,
    ),
    () => setOpen(false),
  );

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
    fd.set("visibility", visibility);
    if (weeklyFocus) fd.set("weekly_focus", "on");
    start(async () => {
      try {
        setError(null);
        await updateTodoMeta(teamId, todo.id, fd);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit to-do"
        className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {/* Portalled: this trigger lives in a row action cluster that fades on
          hover, and opacity applies to a whole subtree — a `fixed` child is
          not exempt from an ancestor that gets one. Same reason the headline
          edit dialog portals; cheaper to be out from under it than to depend
          on which element the fade is set on today. */}
      <ModalShell
        open={open}
        onClose={guard.requestClose}
        // Escape belongs to the discard confirm while it is up.
        dismissible={!guard.asking}
        ariaLabel="Edit to-do"
        size="lg"
        portal
      >
        <ModalHeader title="Edit to-do" onClose={guard.requestClose} />

        <ModalBody as="form" onSubmit={submit}>
          <TodoFormFields
            members={members}
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            ownerId={ownerId}
            onOwnerChange={setOwnerId}
            due={due}
            onDueChange={setDue}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            weeklyFocus={weeklyFocus}
            onWeeklyFocusChange={setWeeklyFocus}
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
        </ModalBody>
      </ModalShell>

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        message="Your edits to this to-do haven't been saved. Close now and they're gone."
      />
    </>
  );
}
