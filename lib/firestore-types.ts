/**
 * Shared Firestore document shapes.
 *
 * These types describe what is actually **stored** in each collection —
 * never a client-serialized projection of it (a "row" type that has crossed
 * an RSC boundary, or added a display-only field, stays declared in the file
 * that needs it; see the comments there for why it diverges).
 *
 * Every type here omits `id` — snapshot code adds it back with `WithId<T>`.
 */

import type { Timestamp } from "firebase-admin/firestore";
import type { GoalDirection, ScorecardUnit } from "@/lib/scorecard";
import type { IssuePriority, IssueStatus, IssueType } from "@/lib/issues";

/** A document as it comes back from a snapshot: stored fields plus its id. */
export type WithId<T> = T & { id: string };

// ---------------------------------------------------------------------------
// rocks
// ---------------------------------------------------------------------------

export type RockDoc = {
  team_id: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
  // Teams this rock is shared with. Must flow through to RockRow — the edit
  // modal seeds its share picker from it, and saving without it wipes the
  // field on the rock doc.
  shared_team_ids?: string[] | null;
  // Timestamp from onSnapshot, absent from the server prefetch (which
  // filters archived rocks out entirely) or on legacy docs created before the
  // field existed. Only ever read as truthy.
  archived_at?: unknown;
};

// ---------------------------------------------------------------------------
// todos (also used for rock milestones, which are todos with source_rock_id
// set and visibility "team")
// ---------------------------------------------------------------------------

export type TodoDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  // A real Firestore Timestamp — null while open. Some readers only ever
  // check it for truthiness; others call toDate()/toMillis() on it directly.
  // Client "use client" segments that also accept the server's pre-rendered
  // props (where a Timestamp can't cross the RSC boundary and arrives as a
  // plain boolean instead) declare their own widened row type locally rather
  // than loosen this one — see segment-rocks.tsx / segment-todos.tsx.
  completed_at: { toDate: () => Date; toMillis: () => number } | null;
  // Present once soft-archived; may be missing entirely on legacy docs
  // (treat as active either way).
  archived_at?: { toDate: () => Date; toMillis: () => number } | null;
  visibility: "team" | "private";
  weekly_focus?: boolean;
  source_issue_id: string | null;
  source_meeting_id: string | null;
  source_rock_id: string | null;
};

// ---------------------------------------------------------------------------
// issues
// ---------------------------------------------------------------------------

export type IssueDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: IssuePriority | null;
  votes: number;
  type: IssueType;
  status: IssueStatus;
  // Legacy-only: no writer in the repo sets this boolean any more
  // (setIssueArchived and the importer both write archived_at), but a legacy
  // doc may still carry it, and isArchivedIssue treats either as archived.
  archived?: boolean;
  // Live client docs may carry a Firestore Timestamp.
  archived_at?: unknown;
};

// ---------------------------------------------------------------------------
// headlines
// ---------------------------------------------------------------------------

export type HeadlineDoc = {
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading" | "general";
  created_by: string | null;
  // Written on every create (addHeadline / the importer) but not included by
  // every reader that builds a HeadlineDoc-shaped object (the L10 headlines
  // segment's server prefetch omits it) — optional here so that stays valid;
  // no surface in this app currently reads it.
  target_team_ids?: string[];
  created_at: Timestamp | null;
  discussed?: boolean;
  archived_at?: Timestamp | null;
  // Org-wide cascade from outside this team — show, don't delete.
  broadcast?: boolean;
  from_label?: string | null;
  source_owner_name?: string | null;
};

// ---------------------------------------------------------------------------
// scorecard_metrics
// ---------------------------------------------------------------------------

export type ScorecardMetricDoc = {
  team_id: string;
  name: string;
  unit: ScorecardUnit;
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  sort_order: number;
  // Optional section label — see scorecard/page.tsx. Missing on metrics
  // created before grouping existed, and on the SSR-serialized
  // `initialMetrics` until the realtime listener replaces it.
  group?: string | null;
  interval?: string | null;
  // Teams that pulled this measurable onto their scorecard from the org-wide
  // "Add existing" picker. The measurable still belongs to `team_id`; these
  // teams read it and its history. Capped at 8 — `firestore.rules` unrolls
  // the membership check index by index and cannot see past that. See
  // `lib/scorecard-share.ts`.
  shared_team_ids?: string[] | null;
  // Soft archive, same convention as rocks / issues / headlines: a timestamp
  // means archived, null or missing means active. Archived measurables drop
  // off scorecards and out of the "Add existing" picker; their values are kept
  // and restoring brings the row back unchanged.
  archived_at?: unknown;
  // Per-borrowing-team section, keyed by team id. `group` above stays the home
  // team's; a borrowing team's choice lives here so putting a pulled row in
  // your own section cannot move it — or change its cadence — on the owner's
  // scorecard. See `metricGroupForTeam`.
  shared_groups?: Record<string, string | null> | null;
};
