"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc } from "firebase/firestore";
import { ExternalLink, X } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useDoc } from "@/lib/firebase/use-collection";
import { NO_ACCESS_TEXT, notificationHref } from "@/lib/notifications";
import {
  DiscardChangesDialog,
  ModalHeader,
  ModalShell,
  useDiscardGuard,
} from "@/components/ui/modal";
import { ActivityFeed } from "@/components/activity-feed";
import { IconButton } from "@/components/ui/button";
import {
  TodoListRow,
  type TodoListItem,
} from "@/app/(app)/teams/[teamId]/todos/todo-list-row";
import { TodoDetails } from "@/app/(app)/teams/[teamId]/todos/todo-details";
import {
  formatClosedOn,
  type TodoBoardDoc,
} from "@/app/(app)/teams/[teamId]/todos/todos-board";
import { loadTodoPeek, type TodoPeek } from "./actions";
import type { NotificationRow } from "./notifications-hub";

/** The same projection the To-Dos board applies to its live rows. */
function toListItem(t: TodoBoardDoc): TodoListItem {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    owner_id: t.owner_id ?? null,
    due_date: t.due_date ?? null,
    completed: !!t.completed_at,
    visibility: t.visibility === "private" ? "private" : "team",
    weekly_focus: t.weekly_focus === true,
    archived: t.archived_at != null,
    closed_on: formatClosedOn(t.archived_at),
    follower_ids: t.follower_ids ?? null,
    assigned_by: t.assigned_by ?? null,
    created_by: t.created_by ?? null,
  };
}

/**
 * A notification's to-do, opened in place.
 *
 * The hub is one inbox across every team, so a click used to mean leaving
 * it for that team's To-Dos tab. This shows the row here instead — the
 * same `TodoListRow` the tab renders, with its details and Follow under
 * it, all live — and keeps "Open in To-Dos" for when you do want the full
 * page. The server action paints the first frame; a doc listener takes over
 * so a check made here shows without a refresh.
 *
 * Two columns, like the to-do's own detail dialog (T4): the to-do on the
 * left, its ActivityFeed on the right — comments and every edit, follow
 * and completion in one newest-first timeline, + Comment folded at the top.
 */
export function TodoPeekModal({
  n,
  userId,
  onClose,
}: {
  n: NotificationRow;
  userId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "gone" } | { status: "ready"; peek: TodoPeek }
  >({ status: "loading" });
  // An unsent comment in the feed asks before the peek closes.
  const [hasDraft, setHasDraft] = useState(false);
  const guard = useDiscardGuard(hasDraft, onClose);

  useEffect(() => {
    let cancelled = false;
    loadTodoPeek(n.team_id, n.entity_id)
      .then((peek) => {
        if (cancelled) return;
        setState(peek ? { status: "ready", peek } : { status: "gone" });
      })
      .catch((e) => {
        console.error("[notifications] peek load failed:", e);
        if (!cancelled) setState({ status: "gone" });
      });
    return () => {
      cancelled = true;
    };
  }, [n.team_id, n.entity_id]);

  return (
    <>
    <ModalShell
      open
      onClose={guard.requestClose}
      ariaLabel="To-do"
      size="5xl"
      portal
      // The comment composer claims Escape to fold itself, and the edit
      // dialog can open on top: only the topmost dialog answers it.
      escape="topmost"
      dismissible={!guard.asking}
    >
      <ModalHeader
        title={
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {state.status === "ready" ? state.peek.todo.title || "To-do" : "To-do"}
            </h2>
            {state.status === "ready" && (
              <p className="text-[11px] text-zinc-500">{state.peek.teamName}</p>
            )}
          </div>
        }
        right={
          <div className="flex items-center gap-1">
            <Link
              href={notificationHref({ ...n, entity_type: "todo" })}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open in To-Dos
            </Link>
            <IconButton onClick={guard.requestClose} aria-label="Close">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        }
      />
      {/* Not ModalBody: the panel is a capped-height flex column, and each
          of these two columns scrolls on its own so a long comment thread
          never pushes the trace out of reach (or vice versa). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {state.status === "loading" && (
          <p className="px-5 py-8 text-center text-sm text-zinc-500 lg:col-span-2">
            Loading…
          </p>
        )}
        {state.status === "gone" && (
          <p className="px-5 py-8 text-center text-sm text-zinc-500 lg:col-span-2">
            {NO_ACCESS_TEXT}
          </p>
        )}
        {state.status === "ready" && (
          <LiveRow
            teamId={n.team_id}
            userId={userId}
            initial={state.peek.todo}
            members={state.peek.members}
            access={state.peek.access}
            onDraftChange={setHasDraft}
          />
        )}
      </div>
    </ModalShell>
    <DiscardChangesDialog
      open={guard.asking}
      onKeepEditing={guard.keepEditing}
      onDiscard={guard.discard}
      title="Discard your comment?"
      discardLabel="Discard comment"
      message="Your comment hasn't been posted. Close now and it's gone."
    />
    </>
  );
}

function LiveRow({
  teamId,
  userId,
  initial,
  members,
  access,
  onDraftChange,
}: {
  teamId: string;
  userId: string;
  initial: TodoBoardDoc;
  members: TodoPeek["members"];
  access: TodoPeek["access"];
  onDraftChange: (hasDraft: boolean) => void;
}) {
  const db = getClientDb();
  const ref = useMemo(() => doc(db, "todos", initial.id), [db, initial.id]);
  const live = useDoc<TodoBoardDoc>(ref, initial, "todo-peek");
  const todo = useMemo(() => toListItem(live), [live]);
  const ownerName =
    todo.owner_id === userId
      ? "You"
      : (members.find((m) => m.user_id === todo.owner_id)?.full_name ?? "—");

  return (
    <>
      <div className="min-h-0 overflow-y-auto">
        <TodoListRow
          teamId={teamId}
          todo={todo}
          ownerName={ownerName}
          members={members}
          userId={userId}
          // Already the to-do's detail: the title doesn't open another.
          opensDetail={false}
          access={access}
        />
        <TodoDetails
          teamId={teamId}
          todo={todo}
          ownerName={ownerName}
          userId={userId}
          className="mb-4 ml-11 mr-4 border-l border-zinc-200 pl-4 dark:border-zinc-800"
        />
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-zinc-200 bg-zinc-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/30 lg:border-l lg:border-t-0">
        <ActivityFeed
          teamId={teamId}
          entityType="todo"
          entityId={todo.id}
          userId={userId}
          members={members}
          onDraftChange={onDraftChange}
        />
      </aside>
    </>
  );
}
