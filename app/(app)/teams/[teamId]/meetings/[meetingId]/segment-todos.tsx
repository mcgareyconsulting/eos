"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  collection,
  doc,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import { addDays, toDateString } from "@/lib/dates";
import { initials } from "@/lib/initials";
import {
  currentSpeakerUid,
  ownersPresentThenAbsent,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
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

type TodoGroup = {
  key: string;
  title: string;
  open: TodoDoc[];
  done: TodoDoc[];
  absent: boolean;
  isCurrentSpeaker: boolean;
};

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

function byDue(a: TodoDoc, b: TodoDoc): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

/**
 * L10 To-Dos: one card per owner (like Rocks). Order = present speakers,
 * then absentees; within each person open then done, each by due date.
 */
function groupTodosForMeeting(
  todos: TodoDoc[],
  members: Member[],
  speakingOrder: string[],
  absent: Set<string>,
  currentSpeaker: string | null,
): TodoGroup[] {
  const byOwner = new Map<string, TodoDoc[]>();
  const unassigned: TodoDoc[] = [];

  for (const t of todos) {
    if (!t.owner_id) {
      unassigned.push(t);
      continue;
    }
    const list = byOwner.get(t.owner_id) ?? [];
    list.push(t);
    byOwner.set(t.owner_id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const sectionOrder = ownersPresentThenAbsent(speakingOrder, absent);
  const placed = new Set<string>();
  const groups: TodoGroup[] = [];

  const pushOwner = (uid: string) => {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) return;
    placed.add(uid);
    groups.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      open: list.filter((t) => !t.completed_at).sort(byDue),
      done: list.filter((t) => t.completed_at).sort(byDue),
      absent: absent.has(uid),
      isCurrentSpeaker: uid === currentSpeaker,
    });
  };

  for (const uid of sectionOrder) pushOwner(uid);

  // Owners with todos who aren't on the roster order (stale id).
  const orphans = [...byOwner.keys()].filter((id) => !placed.has(id));
  orphans.sort((a, b) => {
    const aAbs = absent.has(a) ? 1 : 0;
    const bAbs = absent.has(b) ? 1 : 0;
    if (aAbs !== bAbs) return aAbs - bAbs;
    return (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—");
  });
  for (const uid of orphans) pushOwner(uid);

  if (unassigned.length > 0) {
    groups.push({
      key: "unassigned",
      title: "Unassigned",
      open: unassigned.filter((t) => !t.completed_at).sort(byDue),
      done: unassigned.filter((t) => t.completed_at).sort(byDue),
      absent: false,
      isCurrentSpeaker: false,
    });
  }

  return groups;
}

export function SegmentTodos({
  teamId,
  meetingId,
  userId,
  initialTodos,
  members,
  initialSpeakingOrder = [],
  initialAbsentUserIds = [],
  initialSpeakerIndex = 0,
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  initialTodos: TodoDoc[];
  members: Member[];
  initialSpeakingOrder?: string[];
  initialAbsentUserIds?: string[];
  initialSpeakerIndex?: number;
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

  // Live speaking order + attendance so sections reorder when Segue marks absent.
  const meetingRef = useMemo(
    () => doc(db, "meetings", meetingId),
    [db, meetingId],
  );
  const meeting = useDoc<{
    absent_user_ids?: string[];
    speaking_order?: string[];
    speaking_index?: number;
  }>(
    meetingRef,
    {
      absent_user_ids: initialAbsentUserIds,
      speaking_order: initialSpeakingOrder,
      speaking_index: initialSpeakerIndex,
    },
    "segment-todos",
  );
  const speakingOrder = reconcileSpeakingOrder(meeting.speaking_order, members);
  const absentUserIds = meeting.absent_user_ids ?? [];
  const absent = new Set(absentUserIds);
  const currentSpeaker = currentSpeakerUid(
    speakingOrder,
    meeting.speaking_index ?? 0,
    absentUserIds,
  );

  const visible = [...teamTodos, ...myTodos]
    // Hide milestones (they live in the rocks segment).
    .filter((t) => !t.source_rock_id);

  const groups = groupTodosForMeeting(
    visible,
    members,
    speakingOrder,
    absent,
    currentSpeaker,
  );

  const openCount = groups.reduce((n, g) => n + g.open.length, 0);
  const doneCount = groups.reduce((n, g) => n + g.done.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
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

      {groups.length === 0 && (
        <div className="rounded-xl border border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          No to-dos.
        </div>
      )}

      {openCount === 0 && doneCount > 0 && (
        <div className="rounded-lg border border-hpb-green/30 bg-hpb-green/5 px-4 py-2 text-center text-sm text-hpb-green">
          All to-dos done — nice week.
        </div>
      )}

      {/* One card per owner — same chrome as L10 Rocks. */}
      {groups.map((g) => (
        <section
          key={g.key}
          className={
            "overflow-hidden rounded-xl border bg-white dark:bg-zinc-900 " +
            (g.isCurrentSpeaker
              ? "border-hpb-green/50"
              : "border-zinc-300 dark:border-zinc-800") +
            (g.absent ? " opacity-60" : "")
          }
        >
          <header
            className={
              "flex items-center gap-2 border-b px-4 py-2 " +
              (g.isCurrentSpeaker
                ? "border-hpb-green/30 bg-hpb-green/5 dark:bg-hpb-green/10"
                : "border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50")
            }
          >
            <span
              className={
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                (g.isCurrentSpeaker
                  ? "bg-hpb-green text-white"
                  : "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold")
              }
            >
              {initials(g.title) || "?"}
            </span>
            <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
              {g.title}
            </h3>
            <span className="text-xs text-zinc-500">
              {g.open.length}
              {g.done.length > 0 ? ` · ${g.done.length} done` : ""}
            </span>
            {g.isCurrentSpeaker && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-hpb-green/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-hpb-green ring-1 ring-inset ring-hpb-green/30">
                <span className="h-1.5 w-1.5 rounded-full bg-hpb-green" />
                Now speaking
              </span>
            )}
            {g.absent && !g.isCurrentSpeaker && (
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Absent
              </span>
            )}
          </header>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.open.length === 0 && g.done.length === 0 && (
              <div className="px-4 py-3 text-sm text-zinc-500">No to-dos</div>
            )}
            {g.open.map((t) => (
              <TodoListRow
                key={t.id}
                teamId={teamId}
                todo={toListItem(t)}
                ownerName={g.title}
                members={members}
              />
            ))}
            {g.done.length > 0 && (
              <>
                <div className="bg-zinc-50 px-4 py-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-500">
                  Done
                </div>
                {g.done.map((t) => (
                  <TodoListRow
                    key={t.id}
                    teamId={teamId}
                    todo={toListItem(t)}
                    ownerName={g.title}
                    members={members}
                  />
                ))}
              </>
            )}
          </div>
        </section>
      ))}
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
