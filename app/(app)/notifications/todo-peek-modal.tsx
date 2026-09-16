"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc } from "firebase/firestore";
import { ExternalLink, X } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useDoc } from "@/lib/firebase/use-collection";
import { notificationHref } from "@/lib/notifications";
import { ModalHeader, ModalShell } from "@/components/ui/modal";
import { EntityActivity } from "@/components/entity-activity";
import { IconButton } from "@/components/ui/button";
import {
  TodoListRow,
  type TodoListItem,
} from "@/app/(app)/teams/[teamId]/todos/todo-list-row";
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
  };
}

/**
 * A notification's to-do, opened in place.
 *
 * The hub is one inbox across every team, so a click used to mean leaving
 * it for that team's To-Dos tab. This shows the row here instead — the
 * same `TodoListRow` the tab renders, expanded, with the checkbox, Follow
 * and comments all live — and keeps "Open in To-Dos" for when you do want
 * the full page. The server action paints the first frame; a doc listener
 * takes over so a check or comment made here shows without a refresh.
 *
 * Two columns: the to-do on the left (comment editor folded behind
 * + Comment, so a quiet to-do is not mostly toolbar), and its activity
 * trace on the right — every edit, follow, completion and comment, live.
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
    <ModalShell open onClose={onClose} ariaLabel="To-do" size="5xl" portal>
      <ModalHeader
        title={
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {n.entity_title || "To-do"}
            </h2>
            <p className="text-[11px] text-zinc-500">{n.team_name}</p>
          </div>
        }
        right={
          <div className="flex items-center gap-1">
            <Link
              href={notificationHref(n)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open in To-Dos
            </Link>
            <IconButton onClick={onClose} aria-label="Close">
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
            This to-do is no longer available — it may have been deleted, or
            you may no longer be on its team.
          </p>
        )}
        {state.status === "ready" && (
          <LiveRow
            teamId={n.team_id}
            userId={userId}
            initial={state.peek.todo}
            members={state.peek.members}
          />
        )}
      </div>
    </ModalShell>
  );
}

function LiveRow({
  teamId,
  userId,
  initial,
  members,
}: {
  teamId: string;
  userId: string;
  initial: TodoBoardDoc;
  members: TodoPeek["members"];
}) {
  const db = getClientDb();
  const ref = useMemo(() => doc(db, "todos", initial.id), [db, initial.id]);
  const live = useDoc<TodoBoardDoc>(ref, initial, "todo-peek");
  const todo = useMemo(() => toListItem(live), [live]);
  const ownerName =
    members.find((m) => m.user_id === todo.owner_id)?.full_name ?? "—";

  return (
    <>
      <div className="min-h-0 overflow-y-auto">
        <TodoListRow
          teamId={teamId}
          todo={todo}
          ownerName={ownerName}
          members={members}
          userId={userId}
          defaultExpanded
          commentComposer="collapsed"
        />
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-zinc-200 bg-zinc-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/30 lg:border-l lg:border-t-0">
        <EntityActivity
          teamId={teamId}
          entityType="todo"
          entityId={todo.id}
          visibility={todo.visibility}
          ownerId={todo.owner_id}
          userId={userId}
        />
      </aside>
    </>
  );
}
