"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { daysFromNow } from "@/lib/dates";
import { addTodo } from "./actions";
import { Button } from "@/components/ui/button";
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";
import { TodoFormFields, type Member } from "./todo-form-fields";

/**
 * "Add to-do" button + modal. Same pattern as scorecard Add measurable.
 * Optional meetingId tags L10 captures with source_meeting_id and defaults
 * visibility to team (private/description still available on standalone).
 */
export function AddTodoModal({
  teamId,
  members,
  defaultOwnerId,
  meetingId,
  buttonLabel = "Add to-do",
  compact = false,
}: {
  teamId: string;
  members: Member[];
  defaultOwnerId: string;
  /** When set, to-do is linked to this L10 meeting. */
  meetingId?: string;
  buttonLabel?: string;
  /** Smaller trigger for the L10 toolbar row. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [due, setDue] = useState(daysFromNow(7));
  const [visibility, setVisibility] = useState<"team" | "private">("team");
  const [description, setDescription] = useState("");
  const [weeklyFocus, setWeeklyFocus] = useState(false);

  function resetForOpen() {
    setTitle("");
    setOwnerId(defaultOwnerId);
    setDue(daysFromNow(7));
    setVisibility("team");
    setDescription("");
    setWeeklyFocus(false);
    setError(null);
  }

  function openModal() {
    resetForOpen();
    setOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", title);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    fd.set("visibility", meetingId ? "team" : visibility);
    fd.set("description", description);
    if (weeklyFocus) fd.set("weekly_focus", "on");
    if (meetingId) fd.set("source_meeting_id", meetingId);

    start(async () => {
      try {
        setError(null);
        await addTodo(teamId, fd);
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
        onClick={openModal}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
            : entityAddButtonClass
        }
      >
        <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {buttonLabel}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} ariaLabel="Add to-do" size="lg">
        <ModalHeader title="Add to-do" onClose={() => setOpen(false)} />

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
            showVisibility={!meetingId}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            weeklyFocus={weeklyFocus}
            onWeeklyFocusChange={setWeeklyFocus}
            error={error}
          />

          <ModalFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add to-do"}
            </Button>
          </ModalFooter>
        </ModalBody>
      </ModalShell>
    </>
  );
}
