"use client";

import { useMemo } from "react";
import { Trash2, Lock } from "lucide-react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { formatDateOnly } from "@/lib/dates";
import { TodoCheckbox } from "../../todos/todo-row";
import { deleteTodo } from "../../todos/actions";
import { QuickAddIssue } from "@/components/quick-add-issue";

// completed_at: Timestamp (live) or boolean (server initial) — both truthy-checked.
type TodoDoc = {
  id: string;
  team_id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toDate: () => Date } | boolean | null;
  visibility: "team" | "private";
  source_rock_id: string | null;
};

type Member = { user_id: string; full_name: string };

export function SegmentTodos({
  teamId,
  userId,
  initialTodos,
  members,
}: {
  teamId: string;
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
          Anything not done after 1 week → drop to IDS
        </div>
        <QuickAddIssue
          teamId={teamId}
          prefill="Stale to-do: "
          compact
        />
      </div>

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {open.length === 0 && done.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No to-dos.
          </div>
        )}
        {open.map((t) => (
          <Row
            key={t.id}
            teamId={teamId}
            todo={t}
            ownerName={ownerName(t.owner_id)}
          />
        ))}
        {done.length > 0 && open.length > 0 && (
          <div className="px-4 py-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-950">
            Done
          </div>
        )}
        {done.map((t) => (
          <Row
            key={t.id}
            teamId={teamId}
            todo={t}
            ownerName={ownerName(t.owner_id)}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  teamId,
  todo,
  ownerName,
}: {
  teamId: string;
  todo: TodoDoc;
  ownerName: string;
}) {
  const remove = deleteTodo.bind(null, teamId, todo.id);
  const completed = !!todo.completed_at;
  return (
    <div className="group grid grid-cols-12 gap-3 px-4 py-3 items-center text-sm">
      <div className="col-span-1">
        <TodoCheckbox
          teamId={teamId}
          todoId={todo.id}
          completed={completed}
        />
      </div>
      <div className="col-span-7 min-w-0">
        <span
          className={
            completed
              ? "text-zinc-500 line-through"
              : ""
          }
        >
          {todo.title}
        </span>
        {todo.visibility === "private" && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-zinc-500">
            <Lock className="h-3 w-3" /> private
          </span>
        )}
      </div>
      <div className="col-span-2 text-zinc-600 dark:text-zinc-400">
        {ownerName}
      </div>
      <div className="col-span-1 text-xs text-zinc-600 dark:text-zinc-400">
        {todo.due_date ? formatDateOnly(todo.due_date) : "—"}
      </div>
      <div className="col-span-1 justify-self-end">
        <form action={remove}>
          <button
            type="submit"
            className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
            aria-label="Delete to-do"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
