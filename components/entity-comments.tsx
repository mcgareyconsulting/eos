"use client";

import { useMemo, useState, useTransition } from "react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { MessageSquare, Trash2 } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import {
  addEntityComment,
  deleteEntityComment,
  type CommentEntityType,
} from "@/app/(app)/teams/[teamId]/entity-comments/actions";
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
  created_at: MaybeTimestamp;
};

type Member = { user_id: string; full_name: string };

function tsMs(t: MaybeTimestamp): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}

/** Turn bare URLs into links (Workspace docs, etc.). No full rich text yet. */
function linkify(text: string): React.ReactNode[] {
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]])/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    const href = m[1];
    parts.push(
      <a
        key={`l-${i++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-hpb-blue underline decoration-hpb-blue/30 underline-offset-2 hover:decoration-hpb-blue dark:text-hpb-gold dark:decoration-hpb-gold/40"
      >
        {href}
      </a>,
    );
    last = m.index + href.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : [text];
}

export function EntityComments({
  teamId,
  entityType,
  entityId,
  userId,
  members,
  className,
}: {
  teamId: string;
  entityType: CommentEntityType;
  entityId: string;
  userId: string;
  members: Member[];
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

  const authorName = (id: string) => {
    if (id === userId) return "You";
    return members.find((m) => m.user_id === id)?.full_name ?? "—";
  };

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
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {linkify(c.body)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Add a comment…"
            className="min-h-10 w-full flex-1 resize-y rounded-[10px] border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-hpb-blue focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,51,160,.10)] dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-hpb-blue"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || !body.trim()}
            className="h-10 shrink-0 rounded-[10px] bg-hpb-blue px-4 text-[12.5px] font-extrabold text-white hover:bg-[#00257a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Posting…" : "Post"}
          </button>
        </div>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <p className="text-[11px] text-zinc-400">
            Links open in a new tab · ⌘/Ctrl+Enter
          </p>
        )}
      </div>
    </section>
  );
}
