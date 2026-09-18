"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc } from "firebase/firestore";
import { ExternalLink, X } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useDoc } from "@/lib/firebase/use-collection";
import { notificationHref } from "@/lib/notifications";
import { ownerLabel } from "@/lib/user-name";
import { ModalHeader, ModalShell } from "@/components/ui/modal";
import { EntityActivity } from "@/components/entity-activity";
import { IconButton } from "@/components/ui/button";
import {
  IssueDetailBody,
  type IssueDetailData,
} from "@/app/(app)/teams/[teamId]/issues/issue-detail-modal";
import { loadIssuePeek, type IssuePeek } from "./actions";
import type { NotificationRow } from "./notifications-hub";

/** The live issue doc, as the detail body reads it. */
type IssueLive = IssueDetailData & { owner_id: string | null };

/**
 * A notification's issue, opened in place — the issue counterpart of
 * TodoPeekModal. The same `IssueDetailBody` the Issues tab shows in its
 * modal, with Follow and comments live, and the activity trace beside it.
 * The server action paints the first frame; a doc listener takes over so a
 * follow or comment made here shows without a refresh.
 */
export function IssuePeekModal({
  n,
  userId,
  onClose,
}: {
  n: NotificationRow;
  userId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "gone" } | { status: "ready"; peek: IssuePeek }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadIssuePeek(n.team_id, n.entity_id)
      .then((peek) => {
        if (cancelled) return;
        setState(peek ? { status: "ready", peek } : { status: "gone" });
      })
      .catch((e) => {
        console.error("[notifications] issue peek load failed:", e);
        if (!cancelled) setState({ status: "gone" });
      });
    return () => {
      cancelled = true;
    };
  }, [n.team_id, n.entity_id]);

  return (
    <ModalShell open onClose={onClose} ariaLabel="Issue" size="5xl" portal>
      <ModalHeader
        title={
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {n.entity_title || "Issue"}
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
              Open in Issues
            </Link>
            <IconButton onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {state.status === "loading" && (
          <p className="px-5 py-8 text-center text-sm text-zinc-500 lg:col-span-2">
            Loading…
          </p>
        )}
        {state.status === "gone" && (
          <p className="px-5 py-8 text-center text-sm text-zinc-500 lg:col-span-2">
            This issue is no longer available — it may have been deleted, or
            you may no longer be on its team.
          </p>
        )}
        {state.status === "ready" && (
          <LiveIssue
            teamId={n.team_id}
            userId={userId}
            initial={{ ...state.peek.issue, owner_id: state.peek.ownerId }}
            members={state.peek.members}
          />
        )}
      </div>
    </ModalShell>
  );
}

function LiveIssue({
  teamId,
  userId,
  initial,
  members,
}: {
  teamId: string;
  userId: string;
  initial: IssueLive;
  members: IssuePeek["members"];
}) {
  const db = getClientDb();
  const ref = useMemo(() => doc(db, "issues", initial.id), [db, initial.id]);
  const live = useDoc<IssueLive>(ref, initial, "issue-peek");
  const issue = useMemo<IssueDetailData>(
    () => ({
      id: live.id,
      title: live.title,
      description: live.description ?? null,
      priority: live.priority ?? null,
      votes: Number(live.votes ?? 0),
      type: live.type === "long" ? "long" : "short",
      status: live.status ?? "open",
      follower_ids: live.follower_ids ?? null,
    }),
    [live],
  );
  const ownerName = ownerLabel(
    live.owner_id ?? null,
    (id) => members.find((m) => m.user_id === id)?.full_name,
  );

  return (
    <>
      <div className="min-h-0 overflow-y-auto px-5 py-4">
        <IssueDetailBody
          issue={issue}
          ownerName={ownerName}
          teamId={teamId}
          userId={userId}
          members={members}
          commentComposer="collapsed"
        />
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-zinc-200 bg-zinc-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/30 lg:border-l lg:border-t-0">
        <EntityActivity
          teamId={teamId}
          entityType="issue"
          entityId={issue.id}
          ownerId={live.owner_id ?? null}
          userId={userId}
        />
      </aside>
    </>
  );
}
