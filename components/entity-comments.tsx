"use client";

import { useMemo, useState, useTransition } from "react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  addEntityComment,
  deleteEntityComment,
  type CommentEntityType,
} from "@/app/(app)/teams/[teamId]/entity-comments/actions";
import { RichText } from "@/components/rich-text";
import { RichTextEditor } from "@/components/rich-text-editor";
import { cn } from "@/lib/utils";

type MaybeTimestamp =
  | { toMillis: () => number }
  | number
  | null
  | undefined;

type CommentDoc = {
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

type Member = { user_id: string; full_name: string };

function tsMs(t: MaybeTimestamp): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  return typeof t.toMillis === "function" ? t.toMillis() : null;
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
  members: Member[];
  /**
   * "inline" keeps the editor always open under the thread. "collapsed"
   * hides it behind a + Comment button and folds it away again after a
   * post — for surfaces where the editor's toolbar would otherwise dominate
   * a to-do that has nothing to say yet.
   */
  composer?: "inline" | "collapsed";
  className?: string;
}) {
  const db = getClientDb();
  const q = useMemo(
    () =>
      fsQuery(
        collection(db, "entity_comments"),
        where("team_id", "==", teamId),
        where("entity_type", "==", entityType),
        where("entity_id", "==", entityId),
      ),
    [db, teamId, entityType, entityId],
  );
  const comments = useCollection<CommentDoc>(q, []);
  const sorted = [...comments].sort(
    (a, b) => (tsMs(a.created_at) ?? 0) - (tsMs(b.created_at) ?? 0),
  );

  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(composer === "inline");

  const authorName = (id: string) => {
    if (id === userId) return "You";
    return members.find((m) => m.user_id === id)?.full_name ?? "—";
  };

  // @mentions ride with followers: to-dos and issues have people to tell,
  // rocks do not yet (entity-comments/actions.ts `followable`). The same
  // roster drives the picker and the read-side highlight, so what you
  // picked is what gets lit up.
  const mentionsOn = entityType === "todo" || entityType === "issue";
  const mentionCandidates = useMemo(
    () =>
      mentionsOn
        ? members.map((m) => ({ id: m.user_id, name: m.full_name }))
        : undefined,
    [mentionsOn, members],
  );
  const mentionNames = useMemo(
    () => (mentionsOn ? members.map((m) => m.full_name) : undefined),
    [mentionsOn, members],
  );

  function submit() {
    const t = body.trim();
    if (!t) return;
    const fd = new FormData();
    fd.set("body", t);
    start(async () => {
      try {
        setError(null);
        await addEntityComment(teamId, entityType, entityId, fd);
        setBody("");
        if (composer === "collapsed") setComposing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
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
          {sorted.map((c) => {
            const whenMs = tsMs(c.created_at);
            const when =
              whenMs != null
                ? new Date(whenMs).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—";
            const mine = c.author_id === userId;
            return (
              <li
                key={c.id}
                className="group rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-zinc-500">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {authorName(c.author_id)}
                    </span>
                    {" · "}
                    {when}
                  </span>
                  {mine && (
                    <button
                      type="button"
                      title="Delete comment"
                      aria-label="Delete comment"
                      className="shrink-0 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Delete this comment? This can't be undone.",
                          )
                        ) {
                          return;
                        }
                        start(async () => {
                          try {
                            await deleteEntityComment(teamId, c.id);
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : String(e),
                            );
                          }
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <RichText
                  value={c.body}
                  mentionNames={mentionNames}
                  className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                />
              </li>
            );
          })}
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
            placeholder={mentionsOn ? "Add a comment… @ to mention someone" : "Add a comment…"}
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
          <p className="text-[11px] text-zinc-400">
            Formatting supported · links open in a new tab
            {mentionsOn ? " · @ mentions" : ""} · ⌘/Ctrl+Enter
          </p>
        )}
      </div>
      )}
    </section>
  );
}
