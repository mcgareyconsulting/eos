"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, LayoutGrid, List, MessageSquareText, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import {
  entityToggleIdleClass,
  entityToggleSelectedClass,
} from "@/components/entity-view-tabs";
import { feedbackLabel } from "@/lib/feedback/model";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackItem,
  type FeedbackStatus,
} from "@/lib/feedback/types";
import {
  distinctFeedbackValues,
  feedbackPrUrl,
  feedbackStatusCounts,
  filterFeedbackItems,
  formatFeedbackDate,
  groupFeedbackByColumn,
  sortFeedbackNewestFirst,
} from "@/lib/feedback/view";
import { setFeedbackStatus } from "./actions";
import { FeedbackStatusChip, FEEDBACK_STATUS_TONE } from "./feedback-status-chip";
import { NewFeedbackButton } from "./new-feedback-modal";

type View = "list" | "board";

/** The one-line headline of an item: its summary, else the comment. */
function headline(item: FeedbackItem): string {
  return item.summary ?? item.comment_display ?? item.original_comment;
}

export function FeedbackTracker({ items, view }: { items: FeedbackItem[]; view: View }) {
  const [statuses, setStatuses] = useState<Set<FeedbackStatus>>(() => new Set());
  const [page, setPage] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => sortFeedbackNewestFirst(items), [items]);
  const pages = useMemo(() => distinctFeedbackValues(items, "page"), [items]);
  const reviewers = useMemo(() => distinctFeedbackValues(items, "reviewer"), [items]);
  // Counts on the chips follow the other filters (not the status one), so
  // each chip says how many it would show.
  const beforeStatus = useMemo(
    () => filterFeedbackItems(sorted, { statuses: new Set(), page, reviewer, query }),
    [sorted, page, reviewer, query],
  );
  const counts = useMemo(() => feedbackStatusCounts(beforeStatus), [beforeStatus]);
  const shown = useMemo(
    () => filterFeedbackItems(beforeStatus, { statuses, page: "", reviewer: "", query: "" }),
    [beforeStatus, statuses],
  );
  const filtering = statuses.size > 0 || page !== "" || reviewer !== "" || query.trim() !== "";

  function toggleStatus(s: FeedbackStatus) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function clearFilters() {
    setStatuses(new Set());
    setPage("");
    setReviewer("");
    setQuery("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1" role="group" aria-label="View">
          <Link
            href="/admin/feedback"
            className={cn("min-w-[5.5rem]", view === "list" ? entityToggleSelectedClass : entityToggleIdleClass)}
            aria-current={view === "list" ? "page" : undefined}
          >
            <List className="h-3.5 w-3.5" />
            List
          </Link>
          <Link
            href="/admin/feedback?view=board"
            className={cn("min-w-[5.5rem]", view === "board" ? entityToggleSelectedClass : entityToggleIdleClass)}
            aria-current={view === "board" ? "page" : undefined}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Board
          </Link>
        </div>
        <NewFeedbackButton pages={pages} reviewers={reviewers} />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        <button
          type="button"
          onClick={() => setStatuses(new Set())}
          aria-pressed={statuses.size === 0}
          className={chipClass(statuses.size === 0)}
        >
          All <span className="tabular-nums opacity-70">{beforeStatus.length}</span>
        </button>
        {FEEDBACK_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggleStatus(s)}
            aria-pressed={statuses.has(s)}
            className={chipClass(statuses.has(s))}
          >
            {FEEDBACK_STATUS_LABELS[s]} <span className="tabular-nums opacity-70">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search FB number, summary, comment or resolution"
            className="pl-8"
            aria-label="Search feedback"
          />
        </div>
        <Select value={page} onChange={(e) => setPage(e.target.value)} className="w-44" aria-label="Page">
          <option value="">All pages</option>
          {pages.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          className="w-48"
          aria-label="Reported by"
        >
          <option value="">All reporters</option>
          {reviewers.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        {filtering && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        {filtering ? `${shown.length} of ${items.length} items` : `${items.length} items`}
      </p>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquareText}
            title="No feedback yet"
            hint="Run the seed import (pnpm feedback:import) or log the first item."
          />
        </Card>
      ) : view === "board" ? (
        <FeedbackBoard items={shown} />
      ) : (
        <FeedbackList items={shown} />
      )}
    </div>
  );
}

function chipClass(on: boolean) {
  return cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
    on
      ? "border-hpb-blue bg-hpb-blue text-white dark:border-hpb-gold dark:bg-hpb-gold dark:text-zinc-900"
      : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
  );
}

function PrLinks({ prs }: { prs: number[] }) {
  if (prs.length === 0) return <span className="text-zinc-400">—</span>;
  return (
    <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
      {prs.map((n) => (
        <a
          key={n}
          href={feedbackPrUrl(n)}
          target="_blank"
          rel="noopener noreferrer"
          className="tabular-nums text-hpb-blue hover:underline dark:text-hpb-gold"
        >
          #{n}
        </a>
      ))}
    </span>
  );
}

function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <Card>
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[7%]" />
          <col className="w-[10%]" />
          <col className="w-[13%]" />
          <col className="w-[11%]" />
          <col className="w-[39%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">Reported</th>
            <th className="px-3 py-2 font-medium">Reported by</th>
            <th className="px-3 py-2 font-medium">Page</th>
            <th className="px-3 py-2 font-medium">Summary</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">PRs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                Nothing matches these filters.
              </td>
            </tr>
          )}
          {items.map((item) => (
            <tr key={item.id} className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <td className="px-3 py-2">
                <Link
                  href={`/admin/feedback/${item.id}`}
                  className="font-semibold tabular-nums text-hpb-blue hover:underline dark:text-hpb-gold"
                >
                  {feedbackLabel(item.number)}
                </Link>
              </td>
              <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                {formatFeedbackDate(item.reported_on)}
              </td>
              <td className="break-words px-3 py-2">{item.reviewer}</td>
              <td className="break-words px-3 py-2 text-zinc-600 dark:text-zinc-400">{item.page}</td>
              <td className="px-3 py-2">
                <Link href={`/admin/feedback/${item.id}`} className="line-clamp-2 break-words hover:underline">
                  {headline(item)}
                </Link>
                {item.screenshots.length > 0 && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500">
                    <ImageIcon className="h-3 w-3" />
                    Screenshot
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <FeedbackStatusChip status={item.status} />
                {item.shipped_at && (
                  <div className="mt-1 text-[11px] tabular-nums text-zinc-500">
                    {formatFeedbackDate(item.shipped_at)}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <PrLinks prs={item.prs} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function FeedbackBoard({ items }: { items: FeedbackItem[] }) {
  const groups = useMemo(() => groupFeedbackByColumn(items), [items]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {groups.map(({ column, items: colItems }) => (
        <section
          key={column.id}
          aria-label={column.label}
          className="flex min-w-0 flex-col rounded-xl border border-zinc-300 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <h2 className="text-sm font-semibold tracking-tight">{column.label}</h2>
            <span className="text-xs tabular-nums text-zinc-500">{colItems.length}</span>
          </header>
          <div className="flex flex-col gap-2 p-2">
            {colItems.length === 0 && (
              <p className="px-1 py-3 text-center text-xs text-zinc-400">None</p>
            )}
            {colItems.map((item) => (
              <BoardCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BoardCard({ item }: { item: FeedbackItem }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    start(async () => {
      setError(null);
      const res = await setFeedbackStatus(item.id, next);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
        <Link
          href={`/admin/feedback/${item.id}`}
          className="font-semibold tabular-nums text-hpb-blue hover:underline dark:text-hpb-gold"
        >
          {feedbackLabel(item.number)}
        </Link>
        <span className="truncate">{item.page}</span>
      </div>
      <Link
        href={`/admin/feedback/${item.id}`}
        className="mt-1 line-clamp-3 block break-words text-sm font-medium hover:underline"
      >
        {headline(item)}
      </Link>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span className="truncate">{item.reviewer}</span>
        <span className="shrink-0 tabular-nums">{formatFeedbackDate(item.reported_on)}</span>
      </div>
      <Select
        value={item.status}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        aria-label={`Status of ${feedbackLabel(item.number)}`}
        className={cn("mt-2 h-7 font-semibold ring-1 ring-inset", FEEDBACK_STATUS_TONE[item.status])}
      >
        {FEEDBACK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {FEEDBACK_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}
