"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailShell } from "@/components/detail-shell";
import { CommentCard } from "@/components/entity-comments";
import { RichTextEditor } from "@/components/rich-text-editor";
import { DiscardChangesDialog, useDiscardGuard } from "@/components/ui/modal";
import { useCommentActions } from "@/components/use-entity-thread";
import { loadThread, type LoadedThread } from "@/app/(app)/teams/[teamId]/entity-comments/actions";
import { SYSTEM_ACTOR_ID } from "@/lib/activity";
import { commentDraftKey, setCommentDraft } from "@/lib/comment-drafts";
import { feedbackEditFormFrom } from "@/lib/feedback/edit";
import { feedbackScreenshotUrl } from "@/lib/feedback/screenshots";
import type { FeedbackActivity, FeedbackItem } from "@/lib/feedback/types";
import {
  describeFeedbackActivity,
  feedbackDetailTerms,
  feedbackEyebrow,
  feedbackTitle,
  feedbackWording,
  formatFeedbackDate,
} from "@/lib/feedback/view";
import { EditFeedbackButton } from "./edit-feedback-modal";
import { FeedbackStatusChip } from "./feedback-status-chip";

/** What the page loads server-side for `?item=` (reads gated by the tracker access list). */
export type FeedbackDetailData = {
  item: FeedbackItem;
  activity: FeedbackActivity[];
  /** Actor uid → display name, from /users. */
  actorNames: Record<string, string>;
};

// The thread's entity type in the shared comment system (entity_comments,
// lib/item-registry.ts `feedback`).
const THREAD = "feedback" as const;

/**
 * One feedback item, as a modal over the list or board — design "A": a
 * full-width header (FB number · page · type, Edit, close; the summary; the
 * status line), the item on the left, and a rail with Comments | Activity
 * tabs over a pinned comment composer. The Issues / Rocks detail shell
 * (DetailShell) underneath.
 *
 * `activity` is null while the server render for `?item=` is still on its
 * way — the item itself comes from the list, so the modal opens at once.
 * Comments go through the app's shared thread (entity-comments actions:
 * the tracker's access list is the gate, @mentions resolve against it and
 * notify in-app); no client reads them, so the rail loads them from the
 * server and reloads after a post or delete.
 *
 * The internal resolution note, evidence, PRs and branches stay in the data
 * and out of this modal (Daniel, 2026-10-19).
 */
export function FeedbackDetailModal({
  item,
  activity,
  actorNames,
  userId,
  onClose,
}: {
  item: FeedbackItem;
  activity: FeedbackActivity[] | null;
  actorNames: Record<string, string>;
  /** The signed-in person: "You" on their comments, and may delete them. */
  userId: string;
  onClose: () => void;
}) {
  const eyebrow = feedbackEyebrow(item);
  const title = feedbackTitle(item);

  // Closing with an unsent comment asks first, as Issues and Rocks do.
  const [hasDraft, setHasDraft] = useState(false);
  const guard = useDiscardGuard(hasDraft, onClose);

  return (
    <>
      <DetailShell
        ariaLabel={`${eyebrow.label}: ${title}`}
        onClose={guard.requestClose}
        dismissible={!guard.asking}
        closeButton={false}
        banner={
          <Header item={item} label={eyebrow.label} rest={eyebrow.rest} title={title} onClose={guard.requestClose} />
        }
        bodyClassName="pr-6 sm:pr-7"
        asideLabel="Comments and activity"
        asideClassName="flex flex-col p-0 md:overflow-hidden"
        aside={
          <Conversation
            itemId={item.id}
            activity={activity}
            actorNames={actorNames}
            userId={userId}
            onDraftChange={setHasDraft}
          />
        }
      >
        <ItemBody item={item} label={eyebrow.label} />
      </DetailShell>

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        title="Discard your comment?"
        message="You have a comment you haven't posted. Close now and it's gone."
        discardLabel="Discard comment"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  item,
  label,
  rest,
  title,
  onClose,
}: {
  item: FeedbackItem;
  label: string;
  rest: string[];
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="space-y-2.5 border-b border-zinc-200 px-6 pb-4 pt-5 dark:border-zinc-800 sm:px-7">
      <div className="flex items-center justify-between gap-4">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 text-[13px] text-zinc-600 dark:text-zinc-400">
          <span className="font-extrabold tabular-nums tracking-wide text-hpb-blue dark:text-hpb-gold">{label}</span>
          {rest.map((part) => (
            <span key={part} className="contents">
              <span aria-hidden>·</span>
              <span>{part}</span>
            </span>
          ))}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {/* key: a save re-renders with fresh values; re-seed the form. */}
          <EditFeedbackButton
            key={item.updated_at ?? ""}
            id={item.id}
            label={label}
            initial={feedbackEditFormFrom(item)}
            updatedAt={item.updated_at}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <h2 className="text-[22px] font-extrabold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-zinc-600 dark:text-zinc-400">
        <FeedbackStatusChip status={item.status} />
        {item.shipped_at && (
          <>
            <span>Shipped {formatFeedbackDate(item.shipped_at)}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span>
          Reported {formatFeedbackDate(item.reported_on)} by{" "}
          <span className="font-bold text-zinc-900 dark:text-zinc-100">{item.reviewer}</span>
        </span>
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Left column
// ---------------------------------------------------------------------------

function ItemBody({ item, label }: { item: FeedbackItem; label: string }) {
  const wording = feedbackWording(item);
  const terms = feedbackDetailTerms(item);
  return (
    <div className="space-y-5">
      <Section title="Feedback">
        <blockquote className="rounded-[10px] bg-zinc-100 px-4 py-3 text-[15px] leading-relaxed text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-100">
          <Prose text={wording.text} />
        </blockquote>
        {wording.original && (
          <p className="px-1 text-xs text-zinc-500">
            <span className="font-semibold">Original wording:</span>{" "}
            <span className="whitespace-pre-wrap break-words">{wording.original}</span>
          </p>
        )}
      </Section>

      {item.screenshots.length > 0 && (
        <Section title={item.screenshots.length === 1 ? "Screenshot" : "Screenshots"}>
          <div className="space-y-3">
            {item.screenshots.map((name) => (
              <figure key={name}>
                <a href={feedbackScreenshotUrl(name)} target="_blank" rel="noopener noreferrer">
                  {/* Access-list-only route, private no-store: next/image would
                      cache it through the optimizer, so a plain img. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={feedbackScreenshotUrl(name)}
                    alt={`Screenshot ${name} attached to ${label}`}
                    loading="lazy"
                    decoding="async"
                    className="max-h-[28rem] max-w-full rounded-[10px] border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </a>
                <figcaption className="mt-1 text-[11px] text-zinc-500">{name}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      <section
        aria-label="Resolution"
        className="space-y-1.5 rounded-xl border border-hpb-blue/25 bg-hpb-blue/[0.04] px-4 py-3.5 dark:border-hpb-blue/50 dark:bg-hpb-blue/15"
      >
        <h3 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-hpb-blue dark:text-sky-300">
          Resolution
        </h3>
        {item.client_resolution ? (
          <Prose text={item.client_resolution} className="text-zinc-900 dark:text-zinc-100" />
        ) : (
          <p className="text-sm text-zinc-500">No resolution yet.</p>
        )}
        {item.client_note && (
          <Prose text={item.client_note} className="pt-1 text-zinc-700 dark:text-zinc-300" />
        )}
      </section>

      <dl className="grid grid-cols-1 gap-x-5 gap-y-3 text-[13px] sm:grid-cols-3">
        {terms.map((t) => (
          <div key={t.label} className="min-w-0">
            <dt className="text-zinc-600 dark:text-zinc-400">{t.label}</dt>
            <dd className="mt-0.5 break-words font-semibold text-zinc-900 dark:text-zinc-100">
              {t.value ?? <span className="font-normal text-zinc-400">—</span>}
            </dd>
          </div>
        ))}
      </dl>

      {item.follow_ups.length > 0 && (
        <Section title="Follow-ups">
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
            {item.follow_ups.map((x) => (
              <li key={x} className="break-words">
                {x}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {item.thread && (
        <Section title="Spreadsheet thread" hint="Reviewer replies carried over from the spreadsheet. Read-only.">
          <Prose text={item.thread} className="text-zinc-600 dark:text-zinc-400" />
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-400">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Prose({ text, className }: { text: string; className?: string }) {
  return <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", className)}>{text}</p>;
}

// ---------------------------------------------------------------------------
// Right rail: Comments | Activity, composer pinned at the bottom
// ---------------------------------------------------------------------------

type Tab = "comments" | "activity";

function Conversation({
  itemId,
  activity,
  actorNames,
  userId,
  onDraftChange,
}: {
  itemId: string;
  activity: FeedbackActivity[] | null;
  actorNames: Record<string, string>;
  userId: string;
  onDraftChange: (hasDraft: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("comments");
  const [thread, setThread] = useState<LoadedThread | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    loadThread(THREAD, itemId)
      .then((got) => {
        if (cancelled) return;
        setThread(got);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, version]);

  const { pending, error, setError, post, remove } = useCommentActions("", THREAD, itemId, reload);

  const [body, setBodyState] = useState("");
  const draftKey = commentDraftKey(THREAD, itemId);
  const setBody = (next: string) => {
    setBodyState(next);
    const has = next.trim().length > 0;
    setCommentDraft(draftKey, has);
    onDraftChange(has);
  };
  // Gone from screen, the draft is gone too.
  useEffect(() => () => setCommentDraft(draftKey, false), [draftKey]);

  const submit = () =>
    post(body, () => {
      setBody("");
      setTab("comments");
    });

  const comments = thread?.comments ?? null;
  const mentionNames = thread?.candidates.map((c) => c.name) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Comments and activity"
        className="flex gap-1 border-b border-zinc-200 px-4 pt-3 dark:border-zinc-800"
      >
        <TabButton id="comments" current={tab} onSelect={setTab} label="Comments" count={comments?.length ?? null} />
        <TabButton id="activity" current={tab} onSelect={setTab} label="Activity" count={activity?.length ?? null} />
      </div>

      <div
        role="tabpanel"
        id={`fb-rail-${tab}`}
        aria-labelledby={`fb-tab-${tab}`}
        className="min-h-[10rem] flex-1 overflow-y-auto p-4 md:min-h-0"
      >
        {tab === "comments" ? (
          loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400">The comments could not be loaded. Close and reopen to try again.</p>
          ) : comments === null ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-zinc-500">No comments yet. Questions, decisions and updates for this item go here.</p>
          ) : (
            <ol className="space-y-2.5">
              {comments.map((c) => (
                <li key={c.id}>
                  <CommentCard
                    authorName={c.author_id === userId ? "You" : c.author_name}
                    createdMs={c.created_ms}
                    body={c.body}
                    mentionNames={mentionNames}
                    canDelete={c.author_id === userId || !!thread?.isAdmin}
                    onDelete={() => remove(c.id)}
                  />
                </li>
              ))}
            </ol>
          )
        ) : (
          <ActivityLog activity={activity} names={actorNames} />
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-200 bg-white px-4 pb-4 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
        <label htmlFor={`fb-comment-${itemId}`} className="block text-xs font-bold text-zinc-700 dark:text-zinc-300">
          Comment
        </label>
        <RichTextEditor
          id={`fb-comment-${itemId}`}
          value={body}
          onChange={setBody}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="Write a comment. Type @ to mention someone with tracker access."
          mentionCandidates={thread?.candidates}
          className="w-full rounded-[10px] focus-within:border-hpb-blue focus-within:shadow-[0_0_0_3px_rgba(0,51,160,.10)] focus-within:ring-0 dark:focus-within:border-hpb-blue"
        />
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p role="alert" className="min-w-0 text-xs text-red-600 dark:text-red-400">
              {error}{" "}
              <button type="button" onClick={() => setError(null)} className="underline">
                Dismiss
              </button>
            </p>
          ) : (
            <p className="min-w-0 text-xs text-zinc-600 dark:text-zinc-400" title={thread?.visibleTo}>
              Mentioned people get a notification.
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={pending || !body.trim()}
            className="h-8 shrink-0 rounded-lg bg-hpb-blue px-3.5 text-[13px] font-bold text-white hover:bg-[#00257a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  label,
  count,
}: {
  id: Tab;
  current: Tab;
  onSelect: (t: Tab) => void;
  label: string;
  count: number | null;
}) {
  const selected = id === current;
  return (
    <button
      type="button"
      role="tab"
      id={`fb-tab-${id}`}
      aria-selected={selected}
      aria-controls={`fb-rail-${id}`}
      onClick={() => onSelect(id)}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-[13px]",
        selected
          ? "border-hpb-blue font-bold text-hpb-blue dark:border-hpb-gold dark:text-hpb-gold"
          : "border-transparent font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
      )}
    >
      {label}
      {count !== null && <span className="ml-1 font-semibold text-zinc-500 dark:text-zinc-400">{count}</span>}
    </button>
  );
}

function ActivityLog({
  activity,
  names,
}: {
  activity: FeedbackActivity[] | null;
  names: Record<string, string>;
}) {
  if (activity === null) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (activity.length === 0) return <p className="text-sm text-zinc-500">No activity recorded.</p>;
  return (
    <ol className="space-y-3 text-[13px]">
      {/* Newest first, as a log is read. */}
      {[...activity].reverse().map((a) => (
        <li key={a.id}>
          <span className="font-bold text-zinc-900 dark:text-zinc-100">
            {a.actor_uid === SYSTEM_ACTOR_ID ? "Import" : (names[a.actor_uid] ?? "Unknown user")}
          </span>{" "}
          <span className="text-zinc-700 dark:text-zinc-300">{describeFeedbackActivity(a)}</span>
          <div className="text-xs tabular-nums text-zinc-500">{formatFeedbackDate(a.at)}</div>
        </li>
      ))}
    </ol>
  );
}
