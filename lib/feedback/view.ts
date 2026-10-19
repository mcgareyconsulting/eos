// Feedback tracker — what the admin pages derive from the items: filters,
// status counts, board columns, PR links and the activity wording.
//
// Pure: no Firestore, no React — safe to import from client components.

import { APP_TIME_ZONE, calendarDateIn } from "@/lib/time-zone";
import { boardColumnFor } from "./model";
import {
  FEEDBACK_BOARD_COLUMNS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackActivity,
  type FeedbackBoardColumn,
  type FeedbackEditableField,
  type FeedbackItem,
  type FeedbackStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FeedbackFilters = {
  /** Empty = every status. */
  statuses: ReadonlySet<FeedbackStatus>;
  /** Exact page; empty = every page. */
  page: string;
  /** Exact reviewer; empty = everyone. */
  reviewer: string;
  /** Case-insensitive substring over the label, summary, comments and resolutions. */
  query: string;
};

export const NO_FEEDBACK_FILTERS: FeedbackFilters = {
  statuses: new Set(),
  page: "",
  reviewer: "",
  query: "",
};

/** What the text search reads for one item. */
function searchText(item: FeedbackItem): string {
  return [
    `fb-${String(item.number).padStart(3, "0")}`,
    String(item.number),
    item.summary ?? "",
    item.original_comment,
    item.comment_display ?? "",
    item.client_resolution ?? "",
    item.resolution ?? "",
    item.page,
    item.reviewer,
  ]
    .join("\n")
    .toLowerCase();
}

/** Items matching every set filter, in their given order. */
export function filterFeedbackItems(
  items: readonly FeedbackItem[],
  filters: FeedbackFilters,
): FeedbackItem[] {
  const q = filters.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filters.statuses.size === 0 || filters.statuses.has(item.status)) &&
      (!filters.page || item.page === filters.page) &&
      (!filters.reviewer || item.reviewer === filters.reviewer) &&
      (!q || searchText(item).includes(q)),
  );
}

/** Items per status (every status present, zero when none). */
export function feedbackStatusCounts(
  items: readonly FeedbackItem[],
): Record<FeedbackStatus, number> {
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<
    FeedbackStatus,
    number
  >;
  for (const item of items) counts[item.status]++;
  return counts;
}

/** Distinct non-empty values of a text field, sorted for a filter menu. */
export function distinctFeedbackValues(
  items: readonly FeedbackItem[],
  field: "page" | "reviewer",
): string[] {
  return [...new Set(items.map((i) => i[field]).filter((v) => v !== ""))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Newest report first; ties (same day) by number, highest first. */
export function sortFeedbackNewestFirst(items: readonly FeedbackItem[]): FeedbackItem[] {
  return [...items].sort(
    (a, b) => b.reported_on.localeCompare(a.reported_on) || b.number - a.number,
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export type FeedbackBoardGroup = { column: FeedbackBoardColumn; items: FeedbackItem[] };

/** Every board column, left to right, each with its items in the given order. */
export function groupFeedbackByColumn(items: readonly FeedbackItem[]): FeedbackBoardGroup[] {
  const groups = FEEDBACK_BOARD_COLUMNS.map((column) => ({ column, items: [] as FeedbackItem[] }));
  for (const item of items) {
    const id = boardColumnFor(item.status).id;
    groups.find((g) => g.column.id === id)!.items.push(item);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Links and wording
// ---------------------------------------------------------------------------

export const FEEDBACK_REPO_URL = "https://github.com/mcgareyconsulting/eos";

/** The GitHub page for PR `n`. Only ever a positive integer (prList), so no escaping. */
export function feedbackPrUrl(n: number): string {
  return `${FEEDBACK_REPO_URL}/pull/${n}`;
}

/** Field names as the edit form labels them, for the activity log. */
export const FEEDBACK_FIELD_LABELS: Record<FeedbackEditableField, string> = {
  status: "status",
  reported_on: "reported date",
  reviewer: "reporter",
  page: "page",
  type: "type",
  summary: "summary",
  comment_display: "display comment",
  client_resolution: "resolution for staff",
  resolution: "internal resolution",
  client_note: "client note",
  evidence: "evidence",
  prs: "PRs",
  branches: "branches",
  follow_up_with: "follow up with",
  follow_up_topic: "follow-up topic",
  follow_ups: "follow-ups",
  decision_source: "decision source",
  screenshots: "screenshots",
  shipped_at: "shipped date",
};

function fieldList(fields: readonly FeedbackEditableField[] | undefined): string {
  return (fields ?? []).map((f) => FEEDBACK_FIELD_LABELS[f]).join(", ");
}

/** "set status to Completed (also changed PRs)", "edited internal resolution", … */
export function describeFeedbackActivity(a: FeedbackActivity): string {
  const to = a.to ? FEEDBACK_STATUS_LABELS[a.to] : null;
  switch (a.kind) {
    case "imported":
      return to
        ? `imported from the HPB feedback spreadsheet as ${to}`
        : "imported from the HPB feedback spreadsheet";
    case "created":
      return "logged this item";
    case "status": {
      const others = fieldList(a.fields);
      const from = a.from ? `${FEEDBACK_STATUS_LABELS[a.from]} → ` : "";
      const base = `changed status ${from}${to ?? "?"}`;
      return others ? `${base}; also edited ${others}` : base;
    }
    case "edited":
      return fieldList(a.fields) ? `edited ${fieldList(a.fields)}` : "edited this item";
  }
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * "2026-10-07" → "Oct 7, 2026". A date-time (shipped_at may be one) shows its
 * calendar day on the bank's clock. Anything unreadable is shown as given.
 */
export function formatFeedbackDate(value: string | null): string {
  if (!value) return "—";
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : Number.isNaN(Date.parse(value))
      ? null
      : calendarDateIn(new Date(value), APP_TIME_ZONE);
  if (!ymd) return value;
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : DATE_FMT.format(d);
}
