"use client";

import { useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { CommentEntityType } from "@/app/(app)/teams/[teamId]/entity-comments/actions";
import { RichText } from "@/components/rich-text";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  useCommentActions,
  useCommentAuthorName,
  useEntityComments,
  useMentionNames,
  useThreadInfo,
  type ThreadMember,
} from "@/components/use-entity-thread";
import { tsMs } from "@/lib/activity-feed";
import { cn } from "@/lib/utils";

const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * One comment: author · time, a delete control for its author or an admin,
 * and the rich-text body. Shared by EntityComments and ActivityFeed.
 */
export function CommentCard({
  authorName,
  createdMs,
  body,
  mentionNames,
  canDelete,
  onDelete,
  className,
}: {
  authorName: string;
  createdMs: number | null;
  body: string;
  mentionNames: readonly string[];
  canDelete: boolean;
  onDelete: () => void;
  className?: string;
}) {
  const when =
    createdMs != null ? new Date(createdMs).toLocaleString(undefined, WHEN) : "—";
  return (
    <div
      className={cn(
        "group rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-zinc-500">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {authorName}
          </span>
          {" · "}
          {when}
        </span>
        {canDelete && (
          <button
            type="button"
            title="Delete comment"
            aria-label="Delete comment"
            className="shrink-0 text-zinc-300 opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <RichText
        value={body}
        mentionNames={mentionNames}
        className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
      />
    </div>
  );
}

export function EntityComments({
  teamId,
  entityType,
  entityId,
  userId,
  members,
  composer = "inline",
  className,
}: {
  teamId: string;
  entityType: CommentEntityType;
  entityId: string;
  userId: string;
  members: ThreadMember[];
  /**
   * "inline" keeps the editor always open under the thread. "collapsed"
   * hides it behind a + Comment button and folds it away again after a
   * post — for surfaces where the editor's toolbar would otherwise dominate
   * a to-do that has nothing to say yet.
   */
  composer?: "inline" | "collapsed";
  className?: string;
}) {
  const comments = useEntityComments(teamId, entityType, entityId);
  const sorted = [...comments].sort(
    (a, b) => (tsMs(a.created_at) ?? 0) - (tsMs(b.created_at) ?? 0),
  );

  const [body, setBody] = useState("");
  const [composing, setComposing] = useState(composer === "inline");
  const { pending, error, setError, post, remove } = useCommentActions(
    teamId,
    entityType,
    entityId,
  );

  const info = useThreadInfo(entityType, entityId, composing);
  const authorName = useCommentAuthorName({
    teamId,
    entityType,
    comments,
    userId,
    members,
    info,
  });
  const mentionCandidates = info?.candidates;
  const mentionNames = useMentionNames(info, members);

  function submit() {
    post(body, () => {
      setBody("");
      if (composer === "collapsed") setComposing(false);
    });
  }

  return (
    <section className={cn("space-y-3", className)} aria-label="Comments">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <MessageSquare className="h-3.5 w-3.5" />
        Comments
        <span className="font-normal normal-case tracking-normal text-zinc-400">
          ({sorted.length})
        </span>
      </h3>

      {sorted.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No comments yet. Decision notes and links to docs go here.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((c) => (
            <li key={c.id}>
              <CommentCard
                authorName={authorName(c.author_id)}
                createdMs={tsMs(c.created_at)}
                body={c.body}
                mentionNames={mentionNames}
                canDelete={c.author_id === userId || !!info?.isAdmin}
                onDelete={() => remove(c.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {!composing ? (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-zinc-300 px-2.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Comment
        </button>
      ) : (
      <div className="space-y-1.5">
        <div className="flex items-end gap-2">
          <RichTextEditor
            value={body}
            onChange={setBody}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Add a comment… @ to mention someone"
            mentionCandidates={mentionCandidates}
            className="w-full flex-1 rounded-[10px] focus-within:border-hpb-blue focus-within:shadow-[0_0_0_3px_rgba(0,51,160,.10)] focus-within:ring-0 dark:focus-within:border-hpb-blue"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || !body.trim()}
            className="h-10 shrink-0 rounded-[10px] bg-hpb-blue px-4 text-[12.5px] font-extrabold text-white hover:bg-[#00257a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Posting…" : "Post"}
          </button>
          {composer === "collapsed" && (
            <button
              type="button"
              onClick={() => {
                setBody("");
                setError(null);
                setComposing(false);
              }}
              className="h-10 shrink-0 rounded-[10px] px-3 text-[12.5px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}
        </div>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <div className="space-y-0.5 text-[11px] text-zinc-400">
            {info && <p>{info.visibleTo}</p>}
            <p>
              Formatting supported · links open in a new tab · @ mentions ·
              ⌘/Ctrl+Enter
            </p>
          </div>
        )}
      </div>
      )}
    </section>
  );
}
