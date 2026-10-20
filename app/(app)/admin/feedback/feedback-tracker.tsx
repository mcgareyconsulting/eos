"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ImageIcon,
  LayoutGrid,
  List,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
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
  feedbackStatusCounts,
  feedbackStatusOptions,
  feedbackStatusSummary,
  feedbackTrackerHref,
  filterFeedbackItems,
  formatFeedbackDate,
  groupFeedbackByColumn,
  sortFeedbackNewestFirst,
} from "@/lib/feedback/view";
import { setFeedbackStatus } from "./actions";
import { FeedbackDetailModal, type FeedbackDetailData } from "./feedback-detail-modal";
import { FeedbackStatusChip, FEEDBACK_STATUS_TONE } from "./feedback-status-chip";
import { NewFeedbackButton } from "./new-feedback-modal";

type View = "list" | "board";

const STATUS_OPTIONS: SelectOption<FeedbackStatus>[] = FEEDBACK_STATUSES.map((s) => ({
  value: s,
  label: FEEDBACK_STATUS_LABELS[s],
}));

/** The one-line headline of an item: its summary, else the comment. */
function headline(item: FeedbackItem): string {
  return item.summary ?? item.comment_display ?? item.original_comment;
}

/** A plain click opens the modal in place; a modified click (new tab) follows the link. */
function isPlainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function FeedbackTracker({
  items,
  view,
  itemParam,
  detail,
  userId,
}: {
  items: FeedbackItem[];
  view: View;
  /** `?item=` as the server saw it (may name nothing). */
  itemParam: string | null;
  /** The server's load for `itemParam`, when it names an item. */
  detail: FeedbackDetailData | null;
  /** The signed-in person (their own comments read "You" and can be deleted). */
  userId: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [statuses, setStatuses] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [query, setQuery] = useState("");

  // The open item. Set on click so the modal opens at once (the item is
  // already in `items`); the URL follows, and the server render it triggers
  // brings the activity. A new `?item=` from the server (a link, Back, a
  // freshly logged item) re-syncs it.
  const [openId, setOpenId] = useState<string | null>(itemParam);
  const [syncedParam, setSyncedParam] = useState(itemParam);
  if (itemParam !== syncedParam) {
    setSyncedParam(itemParam);
    setOpenId(itemParam);
  }

  function openItem(id: string) {
    setOpenId(id);
    router.push(feedbackTrackerHref({ view, item: id }), { scroll: false });
  }

  function closeItem() {
    setOpenId(null);
    router.replace(feedbackTrackerHref({ view }), { scroll: false });
  }

  const openDetail = detail && detail.item.id === openId ? detail : null;
  const openFeedback = openDetail?.item ?? (openId ? items.find((i) => i.id === openId) : undefined);
  const missingItem = itemParam !== null && itemParam === openId && !openFeedback;

  const sorted = useMemo(() => sortFeedbackNewestFirst(items), [items]);
  const pages = useMemo(() => distinctFeedbackValues(items, "page"), [items]);
  const reviewers = useMemo(() => distinctFeedbackValues(items, "reviewer"), [items]);
  const pageOptions = useMemo(
    () => [{ value: "", label: "All pages" }, ...pages.map((p) => ({ value: p, label: p }))],
    [pages],
  );
  const reviewerOptions = useMemo(
    () => [{ value: "", label: "All reporters" }, ...reviewers.map((r) => ({ value: r, label: r }))],
    [reviewers],
  );
  const pickedStatuses = statuses as Set<FeedbackStatus>;
  // Counts in the status menu follow the other filters (not the status one),
  // so each option says how many it would show.
  const beforeStatus = useMemo(
    () => filterFeedbackItems(sorted, { statuses: new Set(), page, reviewer, query }),
    [sorted, page, reviewer, query],
  );
  const statusOptions = useMemo(
    () => feedbackStatusOptions(feedbackStatusCounts(beforeStatus)),
    [beforeStatus],
  );
  const shown = useMemo(
    () => filterFeedbackItems(beforeStatus, { statuses: pickedStatuses, page: "", reviewer: "", query: "" }),
    [beforeStatus, pickedStatuses],
  );
  const filtering = statuses.size > 0 || page !== "" || reviewer !== "" || query.trim() !== "";

  function clearFilters() {
    setStatuses(new Set());
    setPage("");
    setReviewer("");
    setQuery("");
  }

  return (
    <div className="space-y-4">
      {/* One toolbar: filters on the left, view toggle + new item on the
          right. Wraps on narrow screens rather than scrolling. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search FB number, summary, comment…"
            className="pl-8"
            aria-label="Search feedback"
          />
        </div>
        <MultiSelect
          label="Statuses"
          options={statusOptions}
          value={statuses}
          onChange={setStatuses}
          triggerText={feedbackStatusSummary(pickedStatuses)}
          className="w-40"
        />
        <SelectMenu
          variant="field"
          aria-label="Filter by page"
          options={pageOptions}
          value={page}
          onChange={setPage}
          className="w-40"
        />
        <SelectMenu
          variant="field"
          aria-label="Filter by reporter"
          options={reviewerOptions}
          value={reviewer}
          onChange={setReviewer}
          className="w-44"
        />
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1" role="group" aria-label="View">
            <Link
              href={feedbackTrackerHref({ view: "list" })}
              className={view === "list" ? entityToggleSelectedClass : entityToggleIdleClass}
              aria-current={view === "list" ? "page" : undefined}
            >
              <List className="h-3.5 w-3.5" />
              List
            </Link>
            <Link
              href={feedbackTrackerHref({ view: "board" })}
              className={view === "board" ? entityToggleSelectedClass : entityToggleIdleClass}
              aria-current={view === "board" ? "page" : undefined}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Board
            </Link>
          </div>
          <NewFeedbackButton pages={pages} reviewers={reviewers} onCreated={openItem} />
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        {filtering ? `${shown.length} of ${items.length} items` : `${items.length} items`}
      </p>

      {missingItem && (
        <p className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          No feedback item “{itemParam}”.
          <button type="button" onClick={closeItem} className="font-medium underline">
            Dismiss
          </button>
        </p>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquareText}
            title="No feedback yet"
            hint="Run the seed import (pnpm feedback:import) or log the first item."
          />
        </Card>
      ) : view === "board" ? (
        <FeedbackBoard items={shown} view={view} onOpen={openItem} />
      ) : (
        <FeedbackList items={shown} view={view} onOpen={openItem} />
      )}

      {/* Portalled to <body>, which the server render doesn't have: a deep
          link opens it on hydration. */}
      {hydrated && openFeedback && (
        <FeedbackDetailModal
          item={openFeedback}
          activity={openDetail?.activity ?? null}
          actorNames={openDetail?.actorNames ?? {}}
          userId={userId}
          onClose={closeItem}
        />
      )}
    </div>
  );
}

/** A link to the item's modal URL that opens the modal in place on a plain click. */
function ItemLink({
  item,
  view,
  onOpen,
  className,
  children,
}: {
  item: FeedbackItem;
  view: View;
  onOpen: (id: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={feedbackTrackerHref({ view, item: item.id })}
      scroll={false}
      onClick={(e) => {
        // The list row is clickable too; don't open twice (or open here as
        // well as in the new tab a modified click asked for).
        e.stopPropagation();
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onOpen(item.id);
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

type ViewProps = { items: FeedbackItem[]; view: View; onOpen: (id: string) => void };

function FeedbackList({ items, view, onOpen }: ViewProps) {
  return (
    <Card>
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[8%]" />
          <col className="w-[11%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
          <col className="w-[43%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">Reported</th>
            <th className="px-3 py-2 font-medium">Reported by</th>
            <th className="px-3 py-2 font-medium">Page</th>
            <th className="px-3 py-2 font-medium">Summary</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                Nothing matches these filters.
              </td>
            </tr>
          )}
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => onOpen(item.id)}
              className="cursor-pointer align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
            >
              <td className="px-3 py-2">
                <ItemLink
                  item={item}
                  view={view}
                  onOpen={onOpen}
                  className="font-semibold tabular-nums text-hpb-blue hover:underline dark:text-hpb-gold"
                >
                  {feedbackLabel(item.number)}
                </ItemLink>
              </td>
              <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                {formatFeedbackDate(item.reported_on)}
              </td>
              <td className="break-words px-3 py-2">{item.reviewer}</td>
              <td className="break-words px-3 py-2 text-zinc-600 dark:text-zinc-400">{item.page}</td>
              <td className="px-3 py-2">
                <span className="line-clamp-2 break-words">{headline(item)}</span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// Which lanes are collapsed, per viewer (a convenience, so browser storage
// is fine; it can come back empty or throw, and the board then starts open).
const COLLAPSED_LANES_KEY = "feedback-board-collapsed";

function readCollapsedLanes(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_LANES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedLanes(lanes: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_LANES_KEY, JSON.stringify([...lanes]));
  } catch {
    // Storage blocked (private window, cleared site data): collapse still
    // works for this visit.
  }
}

function FeedbackBoard({ items, view, onOpen }: ViewProps) {
  const groups = useMemo(() => groupFeedbackByColumn(items), [items]);
  // Server render and first paint start open; the stored choice applies once
  // hydrated, and a toggle replaces it from then on.
  const hydrated = useHydrated();
  const stored = useMemo(() => (hydrated ? readCollapsedLanes() : new Set<string>()), [hydrated]);
  const [toggled, setToggled] = useState<Set<string> | null>(null);
  const collapsed = toggled ?? stored;

  function toggleLane(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeCollapsedLanes(next);
    setToggled(next);
  }

  // Trello-style collapse: a collapsed lane keeps its place as a narrow strip
  // with its name turned on its side (wide screens), or just its header row
  // (narrow screens). Its cards are hidden until it is opened again.
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:items-stretch">
      {groups.map(({ column, items: colItems }) => {
        const isCollapsed = collapsed.has(column.id);
        return (
          <section
            key={column.id}
            aria-label={column.label}
            className={cn(
              "flex min-w-0 flex-col rounded-xl border border-zinc-300 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60",
              isCollapsed ? "lg:w-10 lg:flex-none" : "lg:flex-1",
            )}
          >
            {isCollapsed ? (
              <button
                type="button"
                onClick={() => toggleLane(column.id)}
                aria-expanded={false}
                aria-label={`Expand ${column.label} (${colItems.length})`}
                title={`Expand ${column.label}`}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/60 lg:h-full lg:flex-col lg:justify-start lg:px-0 lg:py-2"
              >
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-zinc-500 lg:block" />
                <ChevronDown className="order-last h-3.5 w-3.5 shrink-0 text-zinc-500 lg:hidden" />
                <span className="flex items-center gap-2 lg:rotate-180 lg:[writing-mode:vertical-rl]">
                  <span className="text-sm font-semibold tracking-tight">{column.label}</span>
                  <span className="text-xs tabular-nums text-zinc-500">{colItems.length}</span>
                </span>
              </button>
            ) : (
              <>
                <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
                  <h2 className="truncate text-sm font-semibold tracking-tight">{column.label}</h2>
                  <span className="flex items-center gap-1">
                    <span className="text-xs tabular-nums text-zinc-500">{colItems.length}</span>
                    <button
                      type="button"
                      onClick={() => toggleLane(column.id)}
                      aria-expanded
                      aria-label={`Collapse ${column.label}`}
                      title={`Collapse ${column.label}`}
                      className="rounded p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <ChevronLeft className="hidden h-3.5 w-3.5 lg:block" />
                      <ChevronUp className="h-3.5 w-3.5 lg:hidden" />
                    </button>
                  </span>
                </header>
                <div className="flex flex-col gap-1.5 p-1.5">
                  {colItems.length === 0 && (
                    <p className="px-1 py-3 text-center text-xs text-zinc-400">None</p>
                  )}
                  {colItems.map((item) => (
                    <BoardCard key={item.id} item={item} view={view} onOpen={onOpen} />
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  item,
  view,
  onOpen,
}: {
  item: FeedbackItem;
  view: View;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: FeedbackStatus) {
    start(async () => {
      setError(null);
      const res = await setFeedbackStatus(item.id, next);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <ItemLink item={item} view={view} onOpen={onOpen} className="block rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span className="font-semibold tabular-nums text-hpb-blue dark:text-hpb-gold">
            {feedbackLabel(item.number)}
          </span>
          <span className="truncate">{item.page}</span>
        </div>
        <span className="mt-1 line-clamp-3 block break-words text-sm font-medium">{headline(item)}</span>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span className="truncate">{item.reviewer}</span>
          <span className="shrink-0 tabular-nums">{formatFeedbackDate(item.reported_on)}</span>
        </div>
      </ItemLink>
      <SelectMenu
        variant="field"
        size="sm"
        aria-label={`Status of ${feedbackLabel(item.number)}`}
        options={STATUS_OPTIONS}
        value={item.status}
        onChange={change}
        disabled={pending}
        className={cn("mt-1.5 font-semibold ring-1 ring-inset", FEEDBACK_STATUS_TONE[item.status])}
      />
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}
