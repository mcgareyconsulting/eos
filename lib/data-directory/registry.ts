// One entry per Firestore collection the /data page can output.
//
// A single registry drives the table, the facets and the CSV, so adding a
// collection later is one object rather than a new page — and, more to the
// point, the export and the importer cannot drift apart: for every type that
// has an `importKind`, `columns` *is* the EXPECTED_HEADERS column set from
// lib/import-headers.ts, which is what makes export → edit → re-import a
// supported round trip. registry.test.ts asserts that subset relationship.
//
// Everything here is pure (doc data in, strings out) so it unit-tests without
// Firestore; the reads live in lib/data-directory/load.ts.

import type { DocumentData } from "firebase-admin/firestore";
import { isArchivedIssue } from "@/lib/issues";
import type { WebImportKind } from "@/lib/import-headers";
import { NO_OWNER_LABEL } from "@/lib/user-name";

/**
 * Collections that must never reach this page, with the reason attached.
 *
 * This exists so that a future "loop over every collection" convenience can't
 * quietly sweep secrets into a CSV that leadership then emails around.
 * `users` is not browsable either — it is read only as a uid → name lookup;
 * the people directory already lives at /directory.
 */
export const DENYLISTED_COLLECTIONS: Record<string, string> = {
  google_tasks_connections: "holds Google OAuth refresh tokens",
  oauth_csrf_states: "short-lived OAuth CSRF secrets",
  users: "PII — used only as a uid → name lookup; see /directory",
};

export type DataTypeKey =
  | "rocks"
  | "todos"
  | "issues"
  | "headlines"
  | "scorecard_metrics"
  | "scorecard_entries"
  | "scorecard_groups"
  | "meetings"
  | "agendas"
  | "teams"
  | "team_members";

/** Normalized lifecycle across every type — native status keeps its own column. */
export type DataState = "active" | "done" | "archived" | "cancelled";

export const DATA_STATES: DataState[] = [
  "active",
  "done",
  "archived",
  "cancelled",
];

/** A document as the loader hands it to the registry. */
export type Doc = DocumentData & { id: string };

export type RowContext = {
  teamName(id: string | null | undefined): string;
  ownerName(id: string | null | undefined): string;
  /** scorecard_entries carry no team_id — they reach it through their metric. */
  metric(id: string | null | undefined): { name: string; team_id: string | null } | null;
};

/** The shape every type collapses to for the mixed "All types" view. */
export type DataRow = {
  type: DataTypeKey;
  typeLabel: string;
  id: string;
  title: string;
  teamId: string | null;
  ownerId: string | null;
  /**
   * Rendered owner. Carried on the row rather than derived at the table,
   * because "no owner" is a real state on a rock but meaningless on a meeting
   * — only the type knows which it is.
   */
  owner: string;
  state: DataState;
  /** Native status/kind, one short string ("Off Track", "Solving", "Private"). */
  detail: string;
  /** ISO 8601, or "" when the type carries no timestamp. */
  updated: string;
  href: string | null;
};

/**
 * The field holding this row's person. Not one name across the schema:
 * headlines record their author (`created_by`) and memberships their subject
 * (`user_id`), so the Owner facet reads whichever this names.
 */
export type OwnerField = "owner_id" | "created_by" | "user_id" | null;

export type DataColumn = {
  header: string;
  get(doc: Doc, ctx: RowContext): string;
};

export type DataTypeDef = {
  key: DataTypeKey;
  label: string;
  collection: string;
  /** Which field names the person this row belongs to, if any. */
  ownerField: OwnerField;
  /** null when the type reaches its team indirectly (scorecard_entries). */
  teamField: "team_id" | null;
  /** Set when the export round-trips through the CSV importer. */
  importKind?: WebImportKind;
  columns: DataColumn[];
  toRow(doc: Doc, ctx: RowContext): DataRow;
};

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------

/** Firestore Timestamp | Date | "YYYY-MM-DD" | null → ISO 8601, or "". */
export function toIso(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") {
    try {
      return ts.toDate().toISOString();
    } catch {
      return "";
    }
  }
  return "";
}

/** Date-only slice for the table; the CSV keeps the full ISO string. */
export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Rich-text descriptions are stored as HTML; a CSV cell wants the text. */
function plain(v: unknown): string {
  return str(v)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(v: unknown): string {
  const s = str(v);
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// Rock status is stored snake_case but the importer speaks the ninety
// vocabulary ("Complete", not "Done") — export in the dialect that re-imports.
const ROCK_STATUS_CSV: Record<string, string> = {
  on_track: "On Track",
  off_track: "Off Track",
  done: "Complete",
  cancelled: "Cancelled",
};

const ROCK_LEVEL_CSV: Record<string, string> = {
  company: "Company",
  department: "Department",
  individual: "Individual",
};

const HEADLINE_KIND_CSV: Record<string, string> = {
  customer: "Customer",
  employee: "Employee",
  cascading: "Cascading",
  general: "General",
};

export function ownerOf(def: DataTypeDef, doc: Doc): string | null {
  if (!def.ownerField) return null;
  return str(doc[def.ownerField]) || null;
}

function teamHref(teamId: string | null, section: string): string | null {
  return teamId ? `/teams/${teamId}/${section}` : null;
}

// ---------------------------------------------------------------------------
// the registry
// ---------------------------------------------------------------------------

const rocks: DataTypeDef = {
  key: "rocks",
  label: "Rocks",
  collection: "rocks",
  ownerField: "owner_id",
  teamField: "team_id",
  importKind: "rocks",
  columns: [
    { header: "Owner", get: (d, c) => c.ownerName(str(d.owner_id)) },
    { header: "Title", get: (d) => str(d.title) },
    { header: "Description", get: (d) => plain(d.description) },
    { header: "Due Date", get: (d) => isoDay(toIso(d.due_date)) },
    { header: "Status", get: (d) => ROCK_STATUS_CSV[str(d.status)] ?? str(d.status) },
    { header: "Level", get: (d) => ROCK_LEVEL_CSV[str(d.rock_type)] ?? "Individual" },
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Quarter", get: (d) => str(d.quarter) },
    { header: "Archived Date", get: (d) => isoDay(toIso(d.archived_at)) },
  ],
  toRow: (d, c) => ({
    type: "rocks",
    owner: c.ownerName(str(d.owner_id)),
    typeLabel: "Rock",
    id: d.id,
    title: str(d.title),
    teamId: str(d.team_id) || null,
    ownerId: str(d.owner_id) || null,
    state:
      d.archived_at != null
        ? "archived"
        : str(d.status) === "done"
          ? "done"
          : str(d.status) === "cancelled"
            ? "cancelled"
            : "active",
    detail: ROCK_STATUS_CSV[str(d.status)] ?? str(d.status),
    updated: toIso(d.due_date),
    href: teamHref(str(d.team_id) || null, "rocks"),
  }),
};

const todos: DataTypeDef = {
  key: "todos",
  label: "To-Dos",
  collection: "todos",
  ownerField: "owner_id",
  teamField: "team_id",
  importKind: "todos",
  columns: [
    { header: "Owner", get: (d, c) => c.ownerName(str(d.owner_id)) },
    { header: "Title", get: (d) => str(d.title) },
    { header: "Description", get: (d) => plain(d.description) },
    { header: "Due Date", get: (d) => isoDay(toIso(d.due_date)) },
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Completed On", get: (d) => isoDay(toIso(d.completed_at)) },
    { header: "Archived Date", get: (d) => isoDay(toIso(d.archived_at)) },
    // The importer reads anything starting with "priv" as private, so the
    // private-to-do decision survives the round trip instead of being dropped.
    { header: "Visibility", get: (d) => (str(d.visibility) === "private" ? "Private" : "Public") },
  ],
  toRow: (d, c) => ({
    type: "todos",
    owner: c.ownerName(str(d.owner_id)),
    typeLabel: str(d.source_rock_id) ? "Milestone" : "To-Do",
    id: d.id,
    title: str(d.title),
    teamId: str(d.team_id) || null,
    ownerId: str(d.owner_id) || null,
    state:
      d.archived_at != null ? "archived" : d.completed_at != null ? "done" : "active",
    detail: str(d.visibility) === "private" ? "Private" : "Public",
    updated: toIso(d.completed_at) || toIso(d.due_date),
    href: teamHref(str(d.team_id) || null, "todos"),
  }),
};

const issues: DataTypeDef = {
  key: "issues",
  label: "Issues",
  collection: "issues",
  ownerField: "owner_id",
  teamField: "team_id",
  importKind: "issues",
  columns: [
    { header: "Owner", get: (d, c) => c.ownerName(str(d.owner_id)) },
    { header: "Title", get: (d) => str(d.title) },
    { header: "Description", get: (d) => plain(d.description) },
    { header: "Type", get: (d) => str(d.type) },
    { header: "Status", get: (d) => str(d.status) },
    { header: "Priority", get: (d) => str(d.priority) },
    { header: "Archived Date", get: (d) => isoDay(toIso(d.archived_at)) },
  ],
  toRow: (d, c) => ({
    type: "issues",
    owner: c.ownerName(str(d.owner_id)),
    typeLabel: "Issue",
    id: d.id,
    title: str(d.title),
    teamId: str(d.team_id) || null,
    ownerId: str(d.owner_id) || null,
    // Legacy docs carry `archived: true` instead of `archived_at` — the same
    // both-conventions test the Issues tab uses.
    state: isArchivedIssue(d as { archived?: boolean; archived_at?: unknown })
      ? "archived"
      : str(d.status) === "solved"
        ? "done"
        : str(d.status) === "dropped"
          ? "cancelled"
          : "active",
    detail: titleCase(d.status),
    updated: toIso(d.archived_at),
    href: teamHref(str(d.team_id) || null, "issues"),
  }),
};

const headlines: DataTypeDef = {
  key: "headlines",
  label: "Headlines",
  collection: "headlines",
  // Headlines record who wrote them, not an assignee.
  ownerField: "created_by",
  teamField: "team_id",
  importKind: "headlines",
  columns: [
    { header: "Owner", get: (d, c) => c.ownerName(str(d.created_by)) },
    { header: "Title", get: (d) => str(d.title) },
    { header: "Description", get: (d) => plain(d.body) },
    { header: "Type", get: (d) => HEADLINE_KIND_CSV[str(d.kind)] ?? "General" },
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Created Date", get: (d) => isoDay(toIso(d.created_at)) },
    { header: "Archived Date", get: (d) => isoDay(toIso(d.archived_at)) },
  ],
  toRow: (d, c) => ({
    type: "headlines",
    owner: c.ownerName(str(d.created_by)),
    typeLabel: "Headline",
    id: d.id,
    title: str(d.title),
    teamId: str(d.team_id) || null,
    ownerId: str(d.created_by) || null,
    state: d.archived_at != null ? "archived" : "active",
    detail: HEADLINE_KIND_CSV[str(d.kind)] ?? "General",
    updated: toIso(d.created_at),
    href: teamHref(str(d.team_id) || null, "headlines"),
  }),
};

const scorecardMetrics: DataTypeDef = {
  key: "scorecard_metrics",
  label: "Measurables",
  collection: "scorecard_metrics",
  ownerField: "owner_id",
  teamField: "team_id",
  // A subset of the scorecard import columns: the measurable definitions
  // round-trip, the per-week values do not. Those are their own type below,
  // because one CSV cannot hold both without a column per period.
  importKind: "scorecard",
  columns: [
    { header: "Title", get: (d) => str(d.name) },
    { header: "Owner", get: (d, c) => c.ownerName(str(d.owner_id)) },
    { header: "Group Name", get: (d) => str(d.group) },
    { header: "Goal", get: (d) => (d.goal == null ? "" : String(d.goal)) },
    { header: "Unit", get: (d) => str(d.unit) },
  ],
  toRow: (d, c) => ({
    type: "scorecard_metrics",
    owner: c.ownerName(str(d.owner_id)),
    typeLabel: "Measurable",
    id: d.id,
    title: str(d.name),
    teamId: str(d.team_id) || null,
    ownerId: str(d.owner_id) || null,
    state: "active",
    detail: str(d.interval) || "weekly",
    updated: "",
    href: teamHref(str(d.team_id) || null, "scorecard"),
  }),
};

const scorecardEntries: DataTypeDef = {
  key: "scorecard_entries",
  label: "Measurable values",
  collection: "scorecard_entries",
  ownerField: null,
  // No team_id on the document — resolved through the parent metric, which is
  // why the loader always fetches scorecard_metrics alongside this type.
  teamField: null,
  columns: [
    { header: "Measurable", get: (d, c) => c.metric(str(d.metric_id))?.name ?? "—" },
    {
      header: "Team",
      get: (d, c) => c.teamName(c.metric(str(d.metric_id))?.team_id ?? null),
    },
    { header: "Week", get: (d) => str(d.week_start_date) },
    { header: "Value", get: (d) => (d.value == null ? "" : String(d.value)) },
    { header: "Note", get: (d) => plain(d.note) },
  ],
  toRow: (d, c) => {
    const metric = c.metric(str(d.metric_id));
    return {
      type: "scorecard_entries",
      owner: "—",
      typeLabel: "Measurable value",
      id: d.id,
      title: `${metric?.name ?? "—"} · ${str(d.week_start_date)}`,
      teamId: metric?.team_id ?? null,
      ownerId: null,
      state: "active",
      detail: d.value == null ? "—" : String(d.value),
      updated: toIso(d.week_start_date),
      href: teamHref(metric?.team_id ?? null, "scorecard"),
    };
  },
};

const scorecardGroups: DataTypeDef = {
  key: "scorecard_groups",
  label: "Measurable groups",
  collection: "scorecard_groups",
  ownerField: null,
  teamField: "team_id",
  columns: [
    { header: "Name", get: (d) => str(d.name) },
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Interval", get: (d) => str(d.interval) || "weekly" },
    { header: "Sort Order", get: (d) => String(d.sort_order ?? 0) },
  ],
  toRow: (d) => ({
    type: "scorecard_groups",
    owner: "—",
    typeLabel: "Measurable group",
    id: d.id,
    title: str(d.name),
    teamId: str(d.team_id) || null,
    ownerId: null,
    state: "active",
    detail: str(d.interval) || "weekly",
    updated: toIso(d.created_at),
    href: teamHref(str(d.team_id) || null, "scorecard"),
  }),
};

const meetings: DataTypeDef = {
  key: "meetings",
  label: "Meetings",
  collection: "meetings",
  ownerField: null,
  teamField: "team_id",
  columns: [
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Started", get: (d) => toIso(d.started_at) },
    { header: "Ended", get: (d) => toIso(d.ended_at) },
    { header: "Agenda", get: (d) => str(d.agenda_id) },
  ],
  toRow: (d, c) => ({
    type: "meetings",
    owner: "—",
    typeLabel: "Meeting",
    id: d.id,
    title: `L10 · ${c.teamName(str(d.team_id))} · ${isoDay(toIso(d.started_at)) || "—"}`,
    teamId: str(d.team_id) || null,
    ownerId: null,
    state: d.ended_at != null ? "done" : "active",
    detail: d.ended_at != null ? "Concluded" : "In progress",
    updated: toIso(d.ended_at) || toIso(d.started_at),
    href: str(d.team_id) ? `/teams/${str(d.team_id)}/meetings/${d.id}` : null,
  }),
};

const agendas: DataTypeDef = {
  key: "agendas",
  label: "Agendas",
  collection: "agendas",
  ownerField: null,
  teamField: "team_id",
  columns: [
    { header: "Name", get: (d) => str(d.name) },
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Created", get: (d) => toIso(d.created_at) },
  ],
  toRow: (d) => ({
    type: "agendas",
    owner: "—",
    typeLabel: "Agenda",
    id: d.id,
    title: str(d.name) || "Agenda",
    teamId: str(d.team_id) || null,
    ownerId: null,
    state: "active",
    detail: "",
    updated: toIso(d.created_at),
    href: teamHref(str(d.team_id) || null, "meetings"),
  }),
};

const teams: DataTypeDef = {
  key: "teams",
  label: "Teams",
  collection: "teams",
  ownerField: null,
  // A team *is* its team; filtering by the facet still has to work, so the
  // loader special-cases the doc id rather than reading a team_id field.
  teamField: null,
  columns: [
    { header: "Name", get: (d) => str(d.name) },
    { header: "Team ID", get: (d) => d.id },
    { header: "Leadership", get: (d) => (d.is_leadership === true ? "Yes" : "") },
    { header: "Meeting Driver", get: (d, c) => c.ownerName(str(d.meeting_driver_id)) },
    { header: "Meet Link", get: (d) => str(d.meet_link) },
  ],
  toRow: (d) => ({
    type: "teams",
    owner: "—",
    typeLabel: "Team",
    id: d.id,
    title: str(d.name) || "Team",
    teamId: d.id,
    ownerId: null,
    state: "active",
    detail: d.is_leadership === true ? "Leadership" : "",
    updated: "",
    href: `/teams/${d.id}/members`,
  }),
};

const teamMembers: DataTypeDef = {
  key: "team_members",
  label: "Memberships",
  collection: "team_members",
  ownerField: "user_id",
  teamField: "team_id",
  columns: [
    { header: "Person", get: (d, c) => c.ownerName(str(d.user_id)) },
    { header: "Team", get: (d, c) => c.teamName(str(d.team_id)) },
    { header: "Role", get: (d) => titleCase(d.role) || "Member" },
    { header: "User ID", get: (d) => str(d.user_id) },
  ],
  toRow: (d, c) => ({
    type: "team_members",
    owner: c.ownerName(str(d.user_id)),
    typeLabel: "Membership",
    id: d.id,
    title: `${c.ownerName(str(d.user_id))} · ${c.teamName(str(d.team_id))}`,
    teamId: str(d.team_id) || null,
    ownerId: str(d.user_id) || null,
    state: "active",
    detail: titleCase(d.role) || "Member",
    updated: "",
    href: teamHref(str(d.team_id) || null, "members"),
  }),
};

export const DATA_TYPES: DataTypeDef[] = [
  rocks,
  todos,
  issues,
  headlines,
  scorecardMetrics,
  scorecardEntries,
  scorecardGroups,
  meetings,
  agendas,
  teams,
  teamMembers,
];

export const DATA_TYPE_BY_KEY = new Map(DATA_TYPES.map((t) => [t.key, t]));

export function isDataTypeKey(v: string): v is DataTypeKey {
  return DATA_TYPE_BY_KEY.has(v as DataTypeKey);
}

/** The Owner facet's value for rows that are unassigned on purpose. */
export const UNOWNED_FILTER_VALUE = "__unowned__";
export const UNOWNED_LABEL = NO_OWNER_LABEL;

