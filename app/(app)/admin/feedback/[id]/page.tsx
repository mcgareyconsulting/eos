import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/text";
import { requireAdmin } from "@/lib/firebase/teams";
import { getFeedbackItem, listFeedbackActivity } from "@/lib/firebase/feedback";
import { loadUserNames } from "@/lib/firebase/user-names";
import { SYSTEM_ACTOR_ID } from "@/lib/activity";
import { feedbackEditFormFrom } from "@/lib/feedback/edit";
import { feedbackLabel } from "@/lib/feedback/model";
import { feedbackScreenshotUrl } from "@/lib/feedback/screenshots";
import { FEEDBACK_TYPE_LABELS, type FeedbackActivity } from "@/lib/feedback/types";
import {
  describeFeedbackActivity,
  feedbackPrUrl,
  formatFeedbackDate,
} from "@/lib/feedback/view";
import { FeedbackStatusChip } from "../feedback-status-chip";
import { EditFeedbackButton } from "./edit-feedback-modal";

/**
 * One feedback item (ROADMAP N73). Admin-only: requireAdmin() 404s anyone
 * else, and every read below checks again. The reporter's original words and
 * the spreadsheet thread are shown read-only; the editable fields go through
 * the Edit dialog (saveFeedbackEdits → updateFeedbackItem).
 */
export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db } = await requireAdmin();
  const { id } = await params;
  const item = await getFeedbackItem(id);
  if (!item) notFound();
  const activity = await listFeedbackActivity(item.id);
  const names = await loadUserNames(
    db,
    activity.map((a) => a.actor_uid).filter((uid) => uid !== SYSTEM_ACTOR_ID),
  );

  const label = feedbackLabel(item.number);
  const shownComment = item.comment_display ?? item.original_comment;
  const originalDiffers =
    item.comment_display !== null && item.comment_display.trim() !== item.original_comment.trim();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <nav className="flex items-center gap-1 text-sm text-zinc-500">
        <Link
          href="/admin/feedback"
          className="inline-flex items-center gap-0.5 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-4 w-4" />
          Feedback tracker
        </Link>
        <span aria-hidden>/</span>
        <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{label}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {item.summary ?? `${label} · ${item.page}`}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Reported {formatFeedbackDate(item.reported_on)} by{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.reviewer}</span>
            {" · "}
            {item.page}
            {" · "}
            {FEEDBACK_TYPE_LABELS[item.type]}
            {item.sheet_row !== null && <> · spreadsheet row {item.sheet_row}</>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <FeedbackStatusChip status={item.status} />
            {item.shipped_at && <span>Shipped {formatFeedbackDate(item.shipped_at)}</span>}
          </div>
        </div>
        <EditFeedbackButton
          id={item.id}
          label={label}
          initial={feedbackEditFormFrom(item)}
          updatedAt={item.updated_at}
        />
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
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
                        className="max-h-[32rem] max-w-full rounded-md border border-zinc-200 dark:border-zinc-800"
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

          <Section title="Activity">
            <ActivityLog activity={activity} names={names} />
          </Section>
        </div>

        <aside className="min-w-0 space-y-5">
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
            <dl className="space-y-2 text-sm">
              <Term label="Follow up with" value={item.follow_up_with} />
              <Term label="Topic" value={item.follow_up_topic} />
            </dl>
            <List items={item.follow_ups} className="mt-2" />
          </Section>

          <Section title="Linked changes">
            <dl className="space-y-2 text-sm">
              <div>
                <Eyebrow as="dt">PRs</Eyebrow>
                <dd className="mt-0.5">
                  {item.prs.length === 0 ? (
                    <Blank />
                  ) : (
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {item.prs.map((n) => (
                        <a
                          key={n}
                          href={feedbackPrUrl(n)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tabular-nums text-hpb-blue hover:underline dark:text-hpb-gold"
                        >
                          PR #{n}
                        </a>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <Eyebrow as="dt">Branches</Eyebrow>
                <dd className="mt-0.5">
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
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Evidence">
            <List items={item.evidence} />
          </Section>

          <Section title="Decision source">
            <TextOrBlank text={item.decision_source} />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
        <Eyebrow as="h2" size="md" className="text-xs">
          {title}
        </Eyebrow>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </Card>
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

function actorName(uid: string, names: Map<string, string>): string {
  if (uid === SYSTEM_ACTOR_ID) return "Import";
  return names.get(uid) ?? "Unknown user";
}

function ActivityLog({
  activity,
  names,
}: {
  activity: FeedbackActivity[];
  names: Map<string, string>;
}) {
  if (activity.length === 0) return <p className="text-sm text-zinc-500">No activity recorded.</p>;
  // Newest first, as a log is read.
  const rows = [...activity].reverse();
  return (
    <ol className="space-y-2 text-sm">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium">{actorName(a.actor_uid, names)}</span>
          <span className="text-zinc-700 dark:text-zinc-300">{describeFeedbackActivity(a)}</span>
          <span className="text-xs tabular-nums text-zinc-500">· {formatFeedbackDate(a.at)}</span>
        </li>
      ))}
    </ol>
  );
}
