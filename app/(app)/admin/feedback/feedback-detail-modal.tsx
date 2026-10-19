"use client";

import type { ReactNode } from "react";
import { DetailShell } from "@/components/detail-shell";
import { SYSTEM_ACTOR_ID } from "@/lib/activity";
import { Eyebrow } from "@/components/ui/text";
import { feedbackEditFormFrom } from "@/lib/feedback/edit";
import { feedbackLabel } from "@/lib/feedback/model";
import { feedbackScreenshotUrl } from "@/lib/feedback/screenshots";
import {
  FEEDBACK_TYPE_LABELS,
  type FeedbackActivity,
  type FeedbackItem,
} from "@/lib/feedback/types";
import { describeFeedbackActivity, formatFeedbackDate } from "@/lib/feedback/view";
import { EditFeedbackButton } from "./edit-feedback-modal";
import { FeedbackStatusChip } from "./feedback-status-chip";

/** What the page loads server-side for `?item=` (admin-gated reads). */
export type FeedbackDetailData = {
  item: FeedbackItem;
  activity: FeedbackActivity[];
  /** Actor uid → display name, from /users. */
  actorNames: Record<string, string>;
};

/**
 * One feedback item, as a modal over the list or board (the Issues / Rocks
 * detail shell: details on the left, activity in the rail). `activity` is
 * null while the server render for `?item=` is still on its way — the item
 * itself comes from the list, so the modal opens at once.
 */
export function FeedbackDetailModal({
  item,
  activity,
  actorNames,
  onClose,
}: {
  item: FeedbackItem;
  activity: FeedbackActivity[] | null;
  actorNames: Record<string, string>;
  onClose: () => void;
}) {
  const label = feedbackLabel(item.number);
  const shownComment = item.comment_display ?? item.original_comment;
  const originalDiffers =
    item.comment_display !== null && item.comment_display.trim() !== item.original_comment.trim();

  return (
    <DetailShell
      ariaLabel={`${label}: ${item.summary ?? item.page}`}
      onClose={onClose}
      aside={<ActivityLog activity={activity} names={actorNames} />}
    >
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold tabular-nums text-hpb-blue dark:text-hpb-gold">{label}</p>
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {item.summary ?? `${item.page} feedback`}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Reported {formatFeedbackDate(item.reported_on)} by{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.reviewer}</span>
            {" · "}
            {item.page}
            {" · "}
            {FEEDBACK_TYPE_LABELS[item.type]}
            {item.sheet_row !== null && <> · spreadsheet row {item.sheet_row}</>}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <FeedbackStatusChip status={item.status} />
            {item.shipped_at && <span>Shipped {formatFeedbackDate(item.shipped_at)}</span>}
            <span className="ml-auto">
              {/* key: a save re-renders with fresh values; re-seed the form. */}
              <EditFeedbackButton
                key={item.updated_at ?? ""}
                id={item.id}
                label={label}
                initial={feedbackEditFormFrom(item)}
                updatedAt={item.updated_at}
              />
            </span>
          </div>
        </header>

        <Section title="Comment">
          <Prose text={shownComment} />
          {originalDiffers && (
            <div className="mt-3 rounded-md border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700">
              <Eyebrow as="dt">Original wording</Eyebrow>
              <Prose text={item.original_comment} className="mt-1 text-zinc-600 dark:text-zinc-400" />
            </div>
          )}
        </Section>

        {item.screenshots.length > 0 && (
          <Section title={item.screenshots.length === 1 ? "Screenshot" : "Screenshots"}>
            <div className="space-y-3">
              {item.screenshots.map((name) => (
                <figure key={name}>
                  <a href={feedbackScreenshotUrl(name)} target="_blank" rel="noopener noreferrer">
                    {/* Admin-only route, private no-store: next/image would
                        cache it through the optimizer, so a plain img. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={feedbackScreenshotUrl(name)}
                      alt={`Screenshot ${name} attached to ${label}`}
                      loading="lazy"
                      decoding="async"
                      className="max-h-[28rem] max-w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                    />
                  </a>
                  <figcaption className="mt-1 text-[11px] text-zinc-500">{name}</figcaption>
                </figure>
              ))}
            </div>
          </Section>
        )}

        {item.thread && (
          <Section title="Thread" hint="Reviewer replies carried over from the spreadsheet. Read-only.">
            <Prose text={item.thread} />
          </Section>
        )}

        <Section title="Resolution for staff" hint="Client-facing.">
          <TextOrBlank text={item.client_resolution} />
        </Section>
        <Section title="Internal resolution" hint="Admins only — never in the client report.">
          <TextOrBlank text={item.resolution} />
        </Section>
        <Section title="Client note">
          <TextOrBlank text={item.client_note} />
        </Section>

        <Section title="Follow-up">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Term label="Follow up with" value={item.follow_up_with} />
            <Term label="Topic" value={item.follow_up_topic} />
          </dl>
          <List items={item.follow_ups} className="mt-2" />
        </Section>

        <Section title="Branches">
          {item.branches.length === 0 ? (
            <Blank />
          ) : (
            <ul className="space-y-0.5">
              {item.branches.map((b) => (
                <li key={b} className="break-all font-mono text-xs">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Evidence">
          <List items={item.evidence} />
        </Section>

        <Section title="Decision source">
          <TextOrBlank text={item.decision_source} />
        </Section>
      </div>
    </DetailShell>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h3>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${className ?? ""}`}>{text}</p>
  );
}

function Blank() {
  return <span className="text-sm text-zinc-400">—</span>;
}

function TextOrBlank({ text }: { text: string | null }) {
  return text ? <Prose text={text} /> : <Blank />;
}

function Term({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <Eyebrow as="dt">{label}</Eyebrow>
      <dd className="mt-0.5 break-words">{value ?? <Blank />}</dd>
    </div>
  );
}

function List({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 0) return <Blank />;
  return (
    <ul className={`list-disc space-y-1 pl-5 text-sm ${className ?? ""}`}>
      {items.map((x) => (
        <li key={x} className="break-words">
          {x}
        </li>
      ))}
    </ul>
  );
}

function ActivityLog({
  activity,
  names,
}: {
  activity: FeedbackActivity[] | null;
  names: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Activity</h3>
      {activity === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : activity.length === 0 ? (
        <p className="text-sm text-zinc-500">No activity recorded.</p>
      ) : (
        <ol className="space-y-2.5 text-sm">
          {/* Newest first, as a log is read. */}
          {[...activity].reverse().map((a) => (
            <li key={a.id}>
              <span className="font-medium">
                {a.actor_uid === SYSTEM_ACTOR_ID ? "Import" : (names[a.actor_uid] ?? "Unknown user")}
              </span>{" "}
              <span className="text-zinc-700 dark:text-zinc-300">{describeFeedbackActivity(a)}</span>
              <div className="text-xs tabular-nums text-zinc-500">{formatFeedbackDate(a.at)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
