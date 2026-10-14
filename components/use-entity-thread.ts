"use client";

// The data half of an item's comment thread, shared by EntityComments (the
// stacked thread) and ActivityFeed (the timeline rail): the live comment
// query, the server's thread info (mention candidates, "Visible to …",
// admin), author names, and post/delete. Rendering stays with each surface.

import { useEffect, useMemo, useState, useTransition } from "react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  addEntityComment,
  deleteEntityComment,
  loadCommentAuthorNames,
  loadThreadInfo,
  type CommentEntityType,
} from "@/app/(app)/teams/[teamId]/entity-comments/actions";
import { loadPersonNames } from "@/app/(app)/teams/[teamId]/todos/actions";
import type { MaybeTimestamp } from "@/lib/activity-feed";
import type { MentionCandidate } from "@/lib/mentions";

export type CommentDoc = {
  id: string;
  team_id: string;
  entity_type: CommentEntityType;
  entity_id: string;
  body: string;
  author_id: string;
  /** Roster uids `@`-mentioned in the body; absent on older comments. */
  mention_ids?: string[];
  created_at: MaybeTimestamp;
};

export type ThreadMember = { user_id: string; full_name: string };

export type ThreadInfo = {
  candidates: MentionCandidate[];
  visibleTo: string;
  isAdmin: boolean;
};

/** Live comments on one item, unsorted. */
export function useEntityComments(
  teamId: string,
  entityType: CommentEntityType,
  entityId: string,
): CommentDoc[] {
  const db = getClientDb();
  // A rock's thread spans every team that has it, and a to-do's is filed
  // under the to-do's own team (an off-team assignee reads it from theirs),
  // so those queries are by entity alone and the rule gates who may read
  // them (item-aware, docs/rules-notes/P9.md). Issue and headline threads
  // stay team-scoped.
  const q = useMemo(
    () =>
      entityType === "rock" || entityType === "todo"
        ? fsQuery(
            collection(db, "entity_comments"),
            where("entity_type", "==", entityType),
            where("entity_id", "==", entityId),
          )
        : fsQuery(
            collection(db, "entity_comments"),
            where("team_id", "==", teamId),
            where("entity_type", "==", entityType),
            where("entity_id", "==", entityId),
          ),
    [db, teamId, entityType, entityId],
  );
  return useCollection<CommentDoc>(q, []);
}

/**
 * Who can be mentioned here and who can read the thread, from the server
 * (the item's access module, not the team roster). Loaded once `enabled`
 * turns on — the surfaces load it when the composer opens.
 */
export function useThreadInfo(
  entityType: CommentEntityType,
  entityId: string,
  enabled: boolean,
): ThreadInfo | null {
  const [info, setInfo] = useState<ThreadInfo | null>(null);
  useEffect(() => {
    if (!enabled || info) return;
    let cancelled = false;
    loadThreadInfo(entityType, entityId)
      .then((got) => {
        if (!cancelled) setInfo(got);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, info, entityType, entityId]);
  return info;
}

/**
 * Display names for comment authors: the viewer is "You", then the roster,
 * then the thread's mention candidates. Authors off all of those (a rock's
 * thread spans teams) are named on demand.
 */
export function useCommentAuthorName({
  teamId,
  entityType,
  comments,
  userId,
  members,
  info,
}: {
  teamId: string;
  entityType: CommentEntityType;
  comments: readonly CommentDoc[];
  userId: string;
  members: readonly ThreadMember[];
  info: ThreadInfo | null;
}): (id: string) => string {
  const [extraNames, setExtraNames] = useState<Record<string, string>>({});
  const unknownAuthors = useMemo(
    () =>
      [...new Set(comments.map((c) => c.author_id))].filter(
        (id) =>
          id !== userId &&
          !members.some((m) => m.user_id === id) &&
          !info?.candidates.some((c) => c.id === id) &&
          !(id in extraNames),
      ),
    [comments, members, userId, extraNames, info],
  );
  useEffect(() => {
    if (unknownAuthors.length === 0) return;
    let cancelled = false;
    // A to-do thread can be read by its assignee from outside the team
    // (P8a), who can't pass loadCommentAuthorNames' team gate; names are
    // directory data, so the to-do path uses the ungated loader.
    (entityType === "todo"
      ? loadPersonNames(unknownAuthors)
      : loadCommentAuthorNames(teamId, unknownAuthors)
    )
      .then((got) => {
        if (cancelled) return;
        // Remember misses too, so an unnamed author isn't refetched forever.
        const filled = Object.fromEntries(unknownAuthors.map((id) => [id, "—"]));
        setExtraNames((prev) => ({ ...prev, ...filled, ...got }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [teamId, entityType, unknownAuthors]);
  return (id: string) => {
    if (id === userId) return "You";
    return (
      members.find((m) => m.user_id === id)?.full_name ??
      info?.candidates.find((c) => c.id === id)?.name ??
      extraNames[id] ??
      "—"
    );
  };
}

/**
 * @mentions work on every thread. The picker lists the people the server
 * sent (greyed when they cannot see the item); the read-side highlight uses
 * the same names, falling back to the roster until they arrive.
 */
export function useMentionNames(
  info: ThreadInfo | null,
  members: readonly ThreadMember[],
): string[] {
  return useMemo(
    () =>
      info
        ? info.candidates.map((c) => c.name)
        : members.map((m) => m.full_name),
    [info, members],
  );
}

/**
 * Post and delete through the existing comment actions — the server's
 * thread gate (requireThreadAccess) and author-or-admin delete check are the
 * permission checks; nothing here grants anything.
 */
export function useCommentActions(
  teamId: string,
  entityType: CommentEntityType,
  entityId: string,
) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** `onPosted` runs only when the comment was saved. */
  function post(body: string, onPosted?: () => void) {
    const t = body.trim();
    if (!t) return;
    const fd = new FormData();
    fd.set("body", t);
    start(async () => {
      try {
        setError(null);
        const result = await addEntityComment(teamId, entityType, entityId, fd);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onPosted?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function remove(commentId: string) {
    if (!window.confirm("Delete this comment? This can't be undone.")) return;
    start(async () => {
      try {
        await deleteEntityComment(teamId, commentId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return { pending, error, setError, post, remove };
}
