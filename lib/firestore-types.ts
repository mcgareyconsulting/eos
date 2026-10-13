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

export type RockDoc = FollowFields & {
  team_id: string;
  title: string;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  status: string;
  description: string | null;
  rock_type: string | null;
  // Company-level rock. Orthogonal to rock_type — a rock may be both a
  // Company rock and a Team rock. Admin-only to set; absent on every doc
  // created before the field existed, so only ever read as `=== true`.
  // Non-admin edits must leave this key out of the patch entirely so the
  // stored value survives (see updateRockWithMilestones).
  is_company_rock?: boolean;
  // The audience (docs/PERMISSIONS_SPEC.md §3.3, lib/access/rock.ts): teams
  // and persons who see and edit the whole rock. Only leaders of the parent
  // team and admins change them; any other save preserves them. No cap.
  audience_team_ids?: string[] | null;
  audience_user_ids?: string[] | null;
  // Private: parent team only — no audience, no blocks on other teams.
  // Leader/admin-only; every milestone assignee must be on the parent team.
  private?: boolean;
  // LEGACY, read-only fallbacks until the P13 migration. A save writes the
  // fields above and deletes these. `shared_team_ids` = audience teams,
  // `team_only` = private. `milestone_owner_ids` grants nothing any more.
  shared_team_ids?: string[] | null;
  team_only?: boolean;
  milestone_owner_ids?: string[];
  // Timestamp from onSnapshot, absent from the server prefetch (which
  // filters archived rocks out entirely) or on legacy docs created before the
  // field existed. Only ever read as truthy.
  archived_at?: unknown;
};

// ---------------------------------------------------------------------------
// todos (also used for rock milestones, which are todos with source_rock_id
// set; a milestone's reach is its rock's — lib/access/rock.ts)
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
  // Who created it. Written by addTodo since the follow feature landed;
  // absent on older docs and on imports, so only ever read as optional.
  created_by?: string | null;
  // Who gets in-app notifications about comments and updates — see
  // lib/notifications.ts. Seeded with creator + owner on create, grows with
  // each reassignment, and toggled by the Follow control on the row. Absent
  // on docs that predate the feature (treated as nobody following).
  follower_ids?: string[] | null;
  // Who made the current assignment — a follower who cannot unfollow
  // (lib/follow.ts). Written by addTodo / updateTodoMeta; absent on older
  // docs, where `created_by` stands in (spec §8 migration).
  assigned_by?: string | null;
};

/**
 * The follow fields every followable item carries (docs/PERMISSIONS_SPEC.md
 * §5.3, lib/follow.ts). Optional everywhere: legacy docs predate them.
 */
export type FollowFields = {
  follower_ids?: string[] | null;
  /** Types with an assigner only (not headlines). */
  assigned_by?: string | null;
};

// ---------------------------------------------------------------------------
// issues
// ---------------------------------------------------------------------------

export type IssueDoc = FollowFields & {
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

export type HeadlineDoc = Omit<FollowFields, "assigned_by"> & {
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
  // Set when the creator was deactivated (spec 2.6): shown as Unassigned.
  owner_unassigned?: boolean;
};

// ---------------------------------------------------------------------------
// scorecard_metrics
// ---------------------------------------------------------------------------

export type ScorecardMetricDoc = FollowFields & {
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
  // Public metrics are visible to every person (other teams find them in the
  // scorecard's "Add existing" picker) and can be tracked by other teams.
  // Missing/false = private. Default false.
  is_public?: boolean | null;
  // Teams tracking this measurable ("track" in the UI; field name kept until a
  // migration). Only a public metric can be tracked; becoming private clears
  // this. No cap — rules use hasAny(team_ids). See `lib/scorecard-share.ts`.
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
