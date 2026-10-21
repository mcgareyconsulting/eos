"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  History,
  ListChecks,
  MessageSquare,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react";
import type { CommentEntityType } from "@/app/(app)/teams/[teamId]/entity-comments/actions";
import type { FeedEntityType } from "@/lib/activity-feed";
import {
  ACTIVITY_DEFAULT_TONE,
  ACTIVITY_KIND_ICON,
  ACTIVITY_KIND_TONE,
} from "@/components/entity-activity";
import { CommentCard } from "@/components/entity-comments";
import { LocalTime } from "@/components/local-time";
import { RichTextEditor } from "@/components/rich-text-editor";
import { commentDraftKey, setCommentDraft } from "@/lib/comment-drafts";
import {
  useCommentActions,
  useCommentAuthorName,
  useEntityComments,
  useMentionNames,
  useThreadInfo,
  type ThreadMember,
} from "@/components/use-entity-thread";
import {
  eventsFromActivity,
  feedCountLabel,
  feedEventSentence,
  mergeTimeline,
  milestoneEventsFromActivity,
  type FeedEvent,
  type FeedEventKind,
} from "@/lib/activity-feed";
import { useTodoActivity } from "@/lib/firebase/use-entity-activity";
import { cn } from "@/lib/utils";

type IconType = React.ComponentType<{ className?: string }>;

const EVENT_ICON: Record<FeedEventKind, IconType> = {
  ...ACTIVITY_KIND_ICON,
  status_changed: CircleDot,
  milestone_completed: ListChecks,
  milestone_reopened: RotateCcw,
  owner_changed: UserRound,
  due_changed: CalendarClock,
  solved: CheckCircle2,
  unsolved: RotateCcw,
};

const EVENT_TONE: Partial<Record<FeedEventKind, string>> = {
  ...ACTIVITY_KIND_TONE,
  milestone_completed: "bg-hpb-green/10 text-hpb-green",
  solved: "bg-hpb-green/10 text-hpb-green",
};

const COMMENT_TONE =
  "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold";

const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const NO_IDS: readonly string[] = [];
const NO_EVENTS: readonly FeedEvent[] = [];

export type ActivityFeedProps = {
  /** The page the feed is shown from; comments are filed under the item's own team. */
  teamId: string;
  /**
   * The item's thread. Not a feedback item: its thread has no live client
   * read (firestore.rules) — the tracker's modal reads it from the server.
   */
  entityType: Extract<CommentEntityType, FeedEntityType>;
  entityId: string;
  /** The viewer — reads as "You", and may delete their own comments. */
  userId: string;
  /** Roster used to name comment authors before the thread info loads. */
  members: ThreadMember[];
  /**
   * Events the caller already holds, built with the lib/activity-feed
   * adapters — e.g. a rock's `eventsFromStatusHistory(statusHistory,
   * labelOf)`. Merged with the comments (and, for a to-do, its live trace).
   */
  events?: readonly FeedEvent[];
  /**
   * Rock only: its milestones. Each milestone is a to-do with its own trace;
   * its ticks and unticks join the feed live ("completed the milestone …").
   */
  milestones?: readonly { id: string; title: string }[];
  /**
   * Solid dot colour for a `status_changed` event's status value (a rock
   * passes its STATUS_BAR lookup). Unset → the neutral tone.
   */
  statusDotClass?: (status: string) => string | undefined;
  /** False hides + Comment (the thread still shows). Default true. */
  canComment?: boolean;
  /**
   * Told whether the composer holds unsent text, so a host dialog can put a
   * discard guard in front of closing (`useDiscardGuard`).
   */
  onDraftChange?: (hasDraft: boolean) => void;
  /** What events call the item, when the entity type's own word is wrong
   *  ("milestone" for a to-do on a rock: "created this milestone"). */
  noun?: string;
  className?: string;
};

/**
 * One item's history: comments and events in a single newest-first
 * timeline, with + Comment at the top that opens the rich-text editor.
 *
 * Generic over the four thread types. Where the rows come from:
 * - comments: the item's `entity_comments` thread, live (the same query and
 *   permission checks as EntityComments; posting and deleting go through
 *   the same server actions);
 * - a to-do: its own `entity_activity` trace, live;
 * - a rock: `milestones` (live milestone ticks) plus `events` from the
 *   caller (status history);
 * - an issue or a headline: `events` from the caller — neither has an
 *   activity trace yet.
 *
 * It shows only the item it is given. Every read is gated by that item's own
 * rule, so a surface that may not show an item (a private to-do on the L10)
 * must not open its feed; the feed adds no way around that.
 */
export function ActivityFeed({
  teamId,
  entityType,
  entityId,
  userId,
  members,
  events = NO_EVENTS,
  milestones,
  statusDotClass,
  canComment = true,
  onDraftChange,
  noun,
  className,
}: ActivityFeedProps) {
  const comments = useEntityComments(teamId, entityType, entityId);
  // Loaded up front, not when the composer opens: it also says whether the
  // viewer is an admin (who may delete any comment) and names mentions.
  const info = useThreadInfo(entityType, entityId, true);
  const authorName = useCommentAuthorName({
    teamId,
    entityType,
    comments,
    userId,
    members,
    info,
  });
  const mentionNames = useMentionNames(info, members);
  const { pending, error, setError, post, remove } = useCommentActions(
    teamId,
    entityType,
    entityId,
  );

  // Live traces: the to-do's own, or a rock's milestones'.
  const milestoneIds = useMemo(
    () => (milestones ? milestones.map((m) => m.id) : NO_IDS),
    [milestones],
  );
  const traceIds = useMemo(
    () => (entityType === "todo" ? [entityId] : NO_IDS),
    [entityType, entityId],
  );
  const ownRows = useTodoActivity(traceIds);
  const milestoneRows = useTodoActivity(
    entityType === "rock" ? milestoneIds : NO_IDS,
  );

  const items = useMemo(() => {
    const titleById = new Map((milestones ?? []).map((m) => [m.id, m.title]));
    return mergeTimeline(comments, [
      ...events,
      ...eventsFromActivity(ownRows),
      ...milestoneEventsFromActivity(milestoneRows, titleById),
    ]);
  }, [comments, events, ownRows, milestoneRows, milestones]);

  const [composing, setComposing] = useState(false);
  const [body, setBodyState] = useState("");
  const draftKey = commentDraftKey(entityType, entityId);
  const setBody = (next: string) => {
    setBodyState(next);
    const has = next.trim().length > 0;
    setCommentDraft(draftKey, has);
    onDraftChange?.(has);
  };
  // Gone from screen, the draft is gone too.
  useEffect(() => () => setCommentDraft(draftKey, false), [draftKey]);
  const collapse = () => {
    setBody("");
    setError(null);
    setComposing(false);
  };
  const submit = () => post(body, collapse);

  const count = feedCountLabel(items);

  return (
    <section className={cn("space-y-3", className)} aria-label="Activity">
      {/* pr-8: in DetailShell the dialog's close button sits over this row. */}
      <h3 className="flex items-center gap-1.5 pr-8 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <History className="h-3.5 w-3.5" aria-hidden />
        Activity
        {count && (
          <span className="truncate font-normal normal-case tracking-normal text-zinc-400">
            · {count}
          </span>
        )}
      </h3>

      {canComment &&
        (!composing ? (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex h-9 w-full items-center gap-1.5 rounded-[10px] border border-dashed border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Comment
          </button>
        ) : (
          <div className="space-y-1.5">
            <RichTextEditor
              value={body}
              onChange={setBody}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  // Claim Escape so the dialog around the feed stays open
                  // (DetailShell skips a key already claimed). An empty
                  // composer folds away; a draft is kept — Cancel discards.
                  e.preventDefault();
                  if (!body.trim()) collapse();
                }
              }}
              rows={3}
              placeholder="Add a comment… @ to mention someone"
              mentionCandidates={info?.candidates}
              className="w-full rounded-[10px] focus-within:border-hpb-blue focus-within:shadow-[0_0_0_3px_rgba(0,51,160,.10)] focus-within:ring-0 dark:focus-within:border-hpb-blue"
            />
            {error ? (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <div className="space-y-0.5 text-[11px] text-zinc-400">
                {info && <p>{info.visibleTo}</p>}
                <p>
                  Formatting supported · @ mentions · ⌘/Ctrl+Enter to post
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={collapse}
                className="h-8 rounded-[10px] px-3 text-[12.5px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !body.trim()}
                className="h-8 rounded-[10px] bg-hpb-blue px-4 text-[12.5px] font-extrabold text-white hover:bg-[#00257a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        ))}

      {!composing && error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">
          Nothing here yet. Comments, status changes and edits show up here,
          newest first.
        </p>
      ) : (
        <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-zinc-200 dark:before:bg-zinc-800">
          {items.map((item) =>
            item.type === "comment" ? (
              <li key={item.key} className="relative flex items-start gap-2.5">
                <Dot tone={COMMENT_TONE} icon={MessageSquare} />
                <CommentCard
                  className="min-w-0 flex-1"
                  authorName={authorName(item.comment.author_id)}
                  createdMs={item.ms}
                  body={item.comment.body}
                  mentionNames={mentionNames}
                  canDelete={
                    item.comment.author_id === userId || !!info?.isAdmin
                  }
                  onDelete={() => remove(item.comment.id)}
                />
              </li>
            ) : (
              <EventRow
                key={item.key}
                event={item.event}
                entityType={entityType}
                noun={noun}
                userId={userId}
                statusDotClass={statusDotClass}
              />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function Dot({
  tone,
  icon: Icon,
  solid,
}: {
  tone: string;
  icon?: IconType;
  /** A plain coloured dot (status colour) instead of a tinted icon. */
  solid?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-zinc-50 dark:ring-zinc-950",
        solid ? "bg-white dark:bg-zinc-900" : tone,
      )}
      aria-hidden
    >
      {solid ? (
        <span className={cn("h-2.5 w-2.5 rounded-full", tone)} />
      ) : Icon ? (
        <Icon className="h-3 w-3" />
      ) : null}
    </span>
  );
}

function EventRow({
  event,
  entityType,
  noun,
  userId,
  statusDotClass,
}: {
  event: FeedEvent;
  entityType: FeedEntityType;
  noun?: string;
  userId: string;
  statusDotClass?: (status: string) => string | undefined;
}) {
  const { actor, text } = feedEventSentence(event, entityType, userId, noun);
  const statusTone =
    event.kind === "status_changed" && event.status
      ? statusDotClass?.(event.status.value)
      : undefined;
  // A status note is the reason for the change — shown whole, like the
  // Status history it replaces. Other details are summaries; clamp them.
  const isNote = event.kind === "status_changed";
  return (
    <li className="relative flex items-start gap-2.5">
      {statusTone ? (
        <Dot tone={statusTone} solid />
      ) : (
        <Dot
          tone={EVENT_TONE[event.kind] ?? ACTIVITY_DEFAULT_TONE}
          icon={EVENT_ICON[event.kind] ?? CircleDot}
        />
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-xs text-zinc-800 dark:text-zinc-200">
          {actor ? (
            <>
              <span className="font-semibold">{actor}</span> {text}
            </>
          ) : (
            <span className="font-semibold">{text}</span>
          )}
        </p>
        {event.detail ? (
          <p
            className={cn(
              "mt-0.5 text-zinc-600 dark:text-zinc-400",
              isNote
                ? "whitespace-pre-wrap text-[13px] leading-snug text-zinc-700 dark:text-zinc-300"
                : "line-clamp-3 text-[11px]",
            )}
          >
            {event.detail}
          </p>
        ) : isNote ? (
          <p className="mt-0.5 text-[11px] italic text-zinc-400">No note</p>
        ) : null}
        <p className="mt-0.5 text-[10px] text-zinc-500">
          <LocalTime ms={event.ms} options={WHEN} fallback="just now" />
        </p>
      </div>
    </li>
  );
}
