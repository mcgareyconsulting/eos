"use client";

import { useState, useTransition } from "react";
import { formatDateOnly } from "@/lib/dates";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { EditableText } from "@/components/editable-text";
import { TodoCheckbox } from "../todos/todo-row";
import { deleteTodo } from "../todos/actions";
import {
  addMilestone,
  updateMilestoneDescription,
  updateMilestoneDueDate,
} from "./actions";

// Plain-data shape passed from the Server Component. Firestore Timestamps
// are class instances and can't cross the RSC boundary, so the parent serializes
// `completed_at` to a boolean before handing milestones to us.
export type MilestoneSerialized = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
  description: string | null;
};

type Member = { user_id: string; full_name: string };

export function MilestonesDisclosure({
  teamId,
  rockId,
  rockOwnerId,
  members,
  milestones,
  /** @deprecated P2-6: milestones no longer prefill EOQ; kept for call-site compat. */
  defaultDue: _defaultDue = "",
  /** When true, list is shown immediately (e.g. parent rock row already expanded). */
  defaultOpen = false,
  /** Hide the chevron toggle — parent owns expand/collapse. */
  alwaysOpen = false,
}: {
  teamId: string;
  rockId: string;
  rockOwnerId: string | null;
  members: Member[];
  milestones: MilestoneSerialized[];
  /** Unused — milestones default to no due date (P2-6). */
  defaultDue?: string;
  defaultOpen?: boolean;
  alwaysOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen);
  // The add form is opt-in, not part of the disclosure: expanding to *read*
  // milestones during an L10 shouldn't shove an entry form into the room.
  const [adding, setAdding] = useState(false);
  const count = milestones.length;
  const doneCount = milestones.filter((m) => m.completed).length;
  const allDone = count > 0 && doneCount === count;
  const showList = alwaysOpen || open;

  return (
    <div className="col-span-12">
      <div className="flex items-center gap-3">
        {alwaysOpen ? (
          <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Milestones
            </span>
            <span
              className={
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset " +
                (count === 0
                  ? "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
                  : allDone
                    ? "bg-hpb-green/10 text-hpb-green ring-hpb-green/30"
                    : "bg-hpb-gold/15 text-hpb-brown dark:text-hpb-gold ring-hpb-gold/30")
              }
            >
              {doneCount}/{count}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronRight
              className={
                "h-3.5 w-3.5 transition-transform " + (open ? "rotate-90" : "")
              }
            />
            <span>Milestones</span>
            <span
              className={
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset " +
                (count === 0
                  ? "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
                  : allDone
                    ? "bg-hpb-green/10 text-hpb-green ring-hpb-green/30"
                    : "bg-hpb-gold/15 text-hpb-brown dark:text-hpb-gold ring-hpb-gold/30")
              }
            >
              {doneCount}/{count}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-100"
        >
          <Plus className="h-3 w-3" />
          Add milestone
        </button>
      </div>

      {showList && (
        <div className="mt-2 ml-5 space-y-2 border-l border-zinc-300 dark:border-zinc-800 pl-4">
          {milestones.length === 0 && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              No milestones yet.
            </p>
          )}
          {milestones.map((m) => (
            <MilestoneRow
              key={m.id}
              teamId={teamId}
              milestone={m}
              ownerName={
                m.owner_id
                  ? (members.find((x) => x.user_id === m.owner_id)?.full_name ??
                    "—")
                  : "—"
              }
            />
          ))}

          {adding && (
            <AddMilestoneForm
              teamId={teamId}
              rockId={rockId}
              members={members}
              defaultOwnerId={rockOwnerId ?? members[0]?.user_id ?? ""}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MilestoneRow({
  teamId,
  milestone,
  ownerName,
}: {
  teamId: string;
  milestone: MilestoneSerialized;
  ownerName: string;
}) {
  const router = useRouter();
  const [editingDue, setEditingDue] = useState(false);
  const [dueDraft, setDueDraft] = useState(milestone.due_date ?? "");
  const [duePending, startDue] = useTransition();
  const remove = deleteTodo.bind(null, teamId, milestone.id);
  const saveDescription = updateMilestoneDescription.bind(
    null,
    teamId,
    milestone.id,
  );

  function commitDue() {
    const next = dueDraft.trim();
    if (next === (milestone.due_date ?? "")) {
      setEditingDue(false);
      return;
    }
    startDue(async () => {
      await updateMilestoneDueDate(teamId, milestone.id, next);
      setEditingDue(false);
      router.refresh();
    });
  }

  return (
    <div className="group flex items-start gap-3 text-sm">
      <div className="pt-0.5">
        <TodoCheckbox
          teamId={teamId}
          todoId={milestone.id}
          completed={milestone.completed}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={
            "truncate " +
            (milestone.completed ? "text-zinc-500 line-through" : "")
          }
        >
          {milestone.title}
        </div>
        <EditableText
          value={milestone.description ?? ""}
          onSave={saveDescription}
          multiline
          placeholder="Add a note"
          className="text-xs text-zinc-600 dark:text-zinc-400"
        />
      </div>
      <span className="whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
        {ownerName}
      </span>
      {editingDue ? (
        <input
          type="date"
          autoFocus
          value={dueDraft}
          disabled={duePending}
          onChange={(e) => setDueDraft(e.target.value)}
          onBlur={commitDue}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setDueDraft(milestone.due_date ?? "");
              setEditingDue(false);
            }
          }}
          aria-label="Milestone due date"
          className="w-32 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDueDraft(milestone.due_date ?? "");
            setEditingDue(true);
          }}
          title="Click to edit due date"
          className="w-24 whitespace-nowrap rounded-sm px-1 text-right text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {milestone.due_date ? formatDateOnly(milestone.due_date) : "—"}
        </button>
      )}
      <form action={remove}>
        <button
          type="submit"
          className="text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
          aria-label="Delete milestone"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

function AddMilestoneForm({
  teamId,
  rockId,
  members,
  defaultOwnerId,
}: {
  teamId: string;
  rockId: string;
  members: Member[];
  defaultOwnerId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  // Empty by default — set a date only when you have one (P2-6).
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    const fd = new FormData();
    fd.set("title", title);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    fd.set("description", description);
    start(async () => {
      await addMilestone(teamId, rockId, fd);
      setTitle("");
      setDue("");
      setDescription("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a milestone"
          className="flex-1 min-w-[10rem] rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
        />
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
        >
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          title="Due date (optional)"
          aria-label="Due date (optional)"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional note for whoever picks this up"
        rows={2}
        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
      />
    </form>
  );
}
