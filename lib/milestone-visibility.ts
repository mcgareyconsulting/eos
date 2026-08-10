// Pure rule for whether a rock milestone (a `todos` doc with a
// `source_rock_id`) should surface on Home's "due soon" / upcoming milestone
// lists. Once a rock is finished, dropped, or has rolled onto the Rocks
// page's Archived tab, its milestones are done too — even if the milestone
// todo itself was never explicitly completed. Without this, an old rock's
// stale milestones (e.g. a May due date) keep showing up as "due soon" or
// overdue forever (roadmap Pass 18 #12, Cora).

export type MilestoneParentRock = {
  status?: string | null;
  archived_at?: unknown | null;
};

const HIDDEN_ROCK_STATUSES = new Set(["done", "cancelled"]);

/**
 * True when the milestone's parent rock is done, cancelled, or archived and
 * the milestone should therefore be hidden from due-soon/upcoming surfaces.
 *
 * A missing rock (not found / not yet fetched) is treated conservatively —
 * `false` (keep showing it) — rather than assuming it's gone.
 */
export function isMilestoneHiddenByRock(
  rock: MilestoneParentRock | null | undefined,
): boolean {
  if (!rock) return false;
  if (rock.archived_at != null) return true;
  return HIDDEN_ROCK_STATUSES.has(String(rock.status ?? ""));
}
