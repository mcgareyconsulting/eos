"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { addDays, toDateString } from "@/lib/dates";
import { addTodo } from "../../todos/actions";
import {
  TodoListRow,
  type TodoListItem,
} from "../../todos/todo-list-row";
import { QuickAddIssue } from "@/components/quick-add-issue";

// completed_at: Timestamp (live) or boolean (server initial) — both truthy-checked.
// description is included so L10 rows mirror the To-Dos tab expand/edit UX.
type TodoDoc = {
  id: string;
  team_id: string;
  title: string;
  description?: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | boolean | null;
  visibility: "team" | "private";
  source_rock_id: string | null;
};

type Member = { user_id: string; full_name: string };

function toListItem(t: TodoDoc): TodoListItem {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    owner_id: t.owner_id,
    due_date: t.due_date,
    completed: !!t.completed_at,
    visibility: t.visibility === "private" ? "private" : "team",
  };
}

export function SegmentTodos({
  teamId,
  meetingId,
  userId,
  initialTodos,
  members,
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  initialTodos: TodoDoc[];
  members: Member[];
}) {
  const db = getClientDb();

  // The Firestore rule for todos rejects a list query unless the rule can
  // prove every result is readable: that means we must constrain visibility
  // or owner_id. Run two subscriptions and merge.
  const teamQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "todos"),
        where("team_id", "==", teamId),
        where("visibility", "==", "team"),
      ),
    [db, teamId],
  );
  const mineQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "todos"),
        where("team_id", "==", teamId),
        where("visibility", "==", "private"),
        where("owner_id", "==", userId),
      ),
    [db, teamId, userId],
  );

  const initialTeam = initialTodos.filter((t) => t.visibility === "team");
  const initialMine = initialTodos.filter(
    (t) => t.visibility === "private" && t.owner_id === userId,
  );
  const teamTodos = useCollection<TodoDoc>(teamQuery, initialTeam);
  const myTodos = useCollection<TodoDoc>(mineQuery, initialMine);

  const visible = [...teamTodos, ...myTodos]
    // Hide milestones (they live in the rocks segment).
    .filter((t) => !t.source_rock_id);

  const byDue = (a: TodoDoc, b: TodoDoc) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  };
  const open = visible.filter((t) => !t.completed_at).sort(byDue);
  const done = visible.filter((t) => t.completed_at).sort(byDue);

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          Anything not done after 1 week → drop to Issues · click title to
          expand · pencil to edit
        </div>
        <QuickAddIssue
          teamId={teamId}
          prefill="Stale to-do: "
          meetingId={meetingId}
        />
      </div>

      {/* Capturing a to-do is the most common action an L10 produces — it
          has to work here, mid-meeting, without leaving for the To-Dos tab
          (the sidebar is hidden in focus mode, so there is no way there). */}
      <AddTodoInline
        teamId={teamId}
        meetingId={meetingId}
        members={members}
        defaultOwnerId={userId}
      />

      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {open.length === 0 && done.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No to-dos.
          </div>
        )}
        {open.length === 0 && done.length > 0 && (
          <div className="px-4 py-3 text-center text-sm text-hpb-green">
            All to-dos done — nice week.
          </div>
        )}
        {open.map((t) => (
          <TodoListRow
            key={t.id}
            teamId={teamId}
            todo={toListItem(t)}
            ownerName={ownerName(t.owner_id)}
            members={members}
          />
        ))}
        {done.length > 0 && (
          <div className="bg-zinc-50 px-4 py-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-500">
            Done
          </div>
        )}
        {done.map((t) => (
          <TodoListRow
            key={t.id}
            teamId={teamId}
            todo={toListItem(t)}
            ownerName={ownerName(t.owner_id)}
            members={members}
          />
        ))}
      </div>
    </div>
  );
}

// Compact in-meeting capture: title + owner + due, team visibility, tagged
// with the meeting it came from. Deliberately smaller than the To-Dos page
// form — private visibility and long descriptions are after-meeting work
// (or the pencil on a row).
function AddTodoInline({
  teamId,
  meetingId,
  members,
  defaultOwnerId,
}: {
  teamId: string;
  meetingId: string;
  members: Member[];
  defaultOwnerId: string;
}) {
  const defaultDue = toDateString(addDays(new Date(), 7));
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [due, setDue] = useState(defaultDue);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    const fd = new FormData();
    fd.set("title", title);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    fd.set("visibility", "team");
    fd.set("source_meeting_id", meetingId);
    start(async () => {
      try {
        setError(null);
        await addTodo(teamId, fd);
        // The live subscription delivers the new row; just clear the form.
        setTitle("");
        setDue(defaultDue);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Capture a to-do…"
        className="min-w-[12rem] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <select
        value={ownerId}
        onChange={(e) => setOwnerId(e.target.value)}
        aria-label="To-do owner"
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
        aria-label="Due date"
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="inline-flex items-center gap-1 rounded-md bg-hpb-blue px-3 py-1 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
        {pending ? "Adding…" : "Add to-do"}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </form>
  );
}
