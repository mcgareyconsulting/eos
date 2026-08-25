// My Home board selection rules (two columns: To-Dos + Rocks).
// Pure helpers so page.tsx stays thin and unit-testable.

import { isMilestoneHiddenByRock } from "@/lib/milestone-visibility";

/** Mirrors rocks/rock-type isDepartmentRock without importing from app/. */
function isDepartmentRock(r: {
  owner_id?: string | null;
  rock_type?: string | null;
}): boolean {
  // Legacy null owner = department; type department/company with person owner too.
  if (r.owner_id == null || r.owner_id === "") return true;
  return r.rock_type === "department" || r.rock_type === "company";
}

export type HomeTodoLike = {
  id: string;
  owner_id: string | null;
  source_rock_id?: string | null;
  completed_at?: unknown | null;
  visibility?: string | null;
};

export type HomeRockLike = {
  id: string;
  owner_id: string | null;
  team_id: string;
  rock_type?: string | null;
  status?: string | null;
  archived_at?: unknown | null;
  /** Guest teams this rock is shared into (may be missing on older docs). */
  shared_team_ids?: string[] | null;
};

export type HomeMilestoneLike = {
  id: string;
  owner_id: string | null;
  source_rock_id: string | null;
  completed_at?: unknown | null;
};

/** Display label for todo visibility — storage stays "team" | "private". */
export function todoVisibilityLabel(
  visibility: string | null | undefined,
): "Public" | "Private" {
  return visibility === "private" ? "Private" : "Public";
}

/**
 * Pure to-dos for the left column: open, assigned to me, not a rock milestone.
 */
export function selectHomeTodos<T extends HomeTodoLike>(
  todos: T[],
  uid: string,
): T[] {
  return todos.filter(
    (t) =>
      t.owner_id === uid &&
      !t.source_rock_id &&
      (t.completed_at == null || t.completed_at === undefined),
  );
}

/**
 * Open milestones for a set of rocks (all owners — for expand checklist).
 * Drops milestones whose parent rock is done/cancelled/archived.
 */
export function selectMilestonesForRocks<T extends HomeMilestoneLike>(
  todos: T[],
  rocksById: Map<
    string,
    { status?: string | null; archived_at?: unknown | null }
  >,
): T[] {
  return todos.filter((t) => {
    if (!t.source_rock_id) return false;
    if (t.completed_at != null && t.completed_at !== undefined) return false;
    const parent = rocksById.get(t.source_rock_id);
    if (parent && isMilestoneHiddenByRock(parent)) return false;
    // Only keep if we know the rock (or parent missing — exclude to avoid orphans)
    return rocksById.has(t.source_rock_id);
  });
}

export function rockHasMyOpenMilestone(
  rockId: string,
  milestones: HomeMilestoneLike[],
  uid: string,
): boolean {
  return milestones.some(
    (m) =>
      m.source_rock_id === rockId &&
      m.owner_id === uid &&
      (m.completed_at == null || m.completed_at === undefined),
  );
}

/**
 * Whether a rock belongs on My Home Rocks column.
 *
 * Include if:
 *  - team/department rock on a team I'm on, or
 *  - I own it, or
 *  - shared into one of my teams, or
 *  - I have an open milestone on it (even if someone else owns the rock)
 *
 * Active statuses only when the rock is "listed" as a normal active rock;
 * milestone-driven inclusion may still surface a rock that was fetched by id
 * — callers should only pass candidates they want considered, and hide
 * done/cancelled/archived via `isHomeRockActive` first.
 */
export function shouldShowHomeRock(
  rock: HomeRockLike,
  opts: {
    uid: string;
    myTeamIds: Set<string>;
    hasMyOpenMilestone: boolean;
  },
): boolean {
  if (!isHomeRockActive(rock)) return false;

  if (rock.owner_id === opts.uid) return true;

  const onMyTeam = opts.myTeamIds.has(rock.team_id);
  if (onMyTeam && isDepartmentRock(rock)) return true;

  const shared = rock.shared_team_ids ?? [];
  if (shared.some((id) => opts.myTeamIds.has(id))) return true;

  if (opts.hasMyOpenMilestone) return true;

  return false;
}

/** Active rocks only — no done / cancelled / archived. */
export function isHomeRockActive(rock: HomeRockLike): boolean {
  if (rock.archived_at != null && rock.archived_at !== undefined) return false;
  const status = String(rock.status ?? "");
  return status === "on_track" || status === "off_track";
}

/**
 * Pill content for a rock row.
 * - Team/department rock → team name or acronym (caller passes display string)
 * - Individual → owner initials or name (caller passes display string)
 * Returns which kind so the UI can style consistently.
 */
export function homeRockPillKind(
  rock: HomeRockLike,
): "team" | "person" {
  if (isDepartmentRock(rock)) return "team";
  if (rock.owner_id == null || rock.owner_id === "") return "team";
  return "person";
}

export function byDueDateAsc<T extends { due_date: string | null }>(
  a: T,
  b: T,
): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

/**
 * Split the Home rocks column into the viewer's own rocks and the
 * department/company ones.
 *
 * N34, Cora on 2026-08-19 reviewing her own Home board: "it's got all of the
 * rocks but it also includes the two departmental ones ... I like seeing the
 * departmental rocks, but I would like them to be in their own section, to be
 * like *my rocks* and *the departmental rocks*. Because at first I was
 * looking at it like, what rocks am I on here?"
 *
 * Split by kind, not by who the viewer is: a department rock the viewer
 * happens to own is still the department's rock, and that is the distinction
 * being asked for. Everything else — owned, shared in, or reached through a
 * milestone assigned to the viewer — is theirs.
 *
 * Uses the same `isDepartmentRock` rule as the rest of this module, which
 * means callers must pass `owner_id`: a legacy rock with no owner counts as
 * departmental, and an item shape missing the field would silently put every
 * rock in that bucket.
 */
export function splitHomeRocksByType<
  T extends { owner_id?: string | null; rock_type?: string | null },
>(rocks: T[]): { mine: T[]; departmental: T[] } {
  const mine: T[] = [];
  const departmental: T[] = [];
  for (const r of rocks) {
    if (isDepartmentRock(r)) departmental.push(r);
    else mine.push(r);
  }
  return { mine, departmental };
}
