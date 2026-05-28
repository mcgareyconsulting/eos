"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { TodoCheckbox } from "../todos/todo-row";
import { deleteTodo } from "../todos/actions";
import { addMilestone } from "./actions";

// Plain-data shape passed from the Server Component. Firestore Timestamps
// are class instances and can't cross the RSC boundary, so the parent serializes
// `completed_at` to a boolean before handing milestones to us.
export type MilestoneSerialized = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
};

type Member = { user_id: string; full_name: string };

export function MilestonesDisclosure({
  teamId,
  rockId,
  rockOwnerId,
  members,
  milestones,
  defaultDue,
}: {
  teamId: string;
  rockId: string;
  rockOwnerId: string | null;
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
}) {
  const [open, setOpen] = useState(false);
  const count = milestones.length;
  const doneCount = milestones.filter((m) => m.completed).length;
  const allDone = count > 0 && doneCount === count;

  return (
    <div className="col-span-12">
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
        {count === 0 ? (
          <span className="inline-flex items-center gap-1">
            <Plus className="h-3 w-3" />
            Add milestones
          </span>
        ) : (
          <>
            <span>Milestones</span>
            <span
              className={
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset " +
                (allDone
                  ? "bg-hpb-green/10 text-hpb-green ring-hpb-green/30"
                  : "bg-hpb-gold/15 text-hpb-brown dark:text-hpb-gold ring-hpb-gold/30")
              }
            >
              {doneCount}/{count}
            </span>
          </>
        )}
      </button>

      {open && (
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
                  ? members.find((x) => x.user_id === m.owner_id)?.full_name ??
                    "—"
                  : "—"
              }
            />
          ))}

          <AddMilestoneForm
            teamId={teamId}
            rockId={rockId}
            members={members}
            defaultOwnerId={rockOwnerId ?? members[0]?.user_id ?? ""}
            defaultDue={defaultDue}
          />
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
  const remove = deleteTodo.bind(null, teamId, milestone.id);
  return (
    <div className="group flex items-center gap-3 text-sm">
      <TodoCheckbox
        teamId={teamId}
        todoId={milestone.id}
        completed={milestone.completed}
      />
      <div
        className={
          "flex-1 min-w-0 truncate " +
          (milestone.completed ? "text-zinc-500 line-through" : "")
        }
      >
        {milestone.title}
      </div>
      <span className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
        {ownerName}
      </span>
      <span className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap w-24 text-right">
        {milestone.due_date
          ? new Date(milestone.due_date).toLocaleDateString()
          : "—"}
      </span>
      <form action={remove}>
        <button
          type="submit"
          className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
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
  defaultDue,
}: {
  teamId: string;
  rockId: string;
  members: Member[];
  defaultOwnerId: string;
  defaultDue: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [due, setDue] = useState(defaultDue);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    const fd = new FormData();
    fd.set("title", title);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    start(async () => {
      await addMilestone(teamId, rockId, fd);
      setTitle("");
      setDue(defaultDue);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800"
    >
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
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
      >
        Add
      </button>
    </form>
  );
}
