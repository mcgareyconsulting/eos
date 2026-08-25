import { daysUntil } from "@/lib/dates";

// Pure rules for whether a rock milestone (a `todos` doc with a
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

/**
 * How far ahead a milestone has to be due before it stops being a reminder.
 *
 * N29: surfacing every open milestone turned the To-Dos page into an
 * inventory — daniel, driving it live, called it "a broken page ... they're
 * just vomit at the top of the to-dos page, so you got to scroll to the
 * bottom", and Joe asked for "just a drop down that showed upcoming
 * milestones in the next two weeks". Two weeks is also already this app's
 * urgency threshold — it is where `dueToneClass` turns amber — so the
 * reminder window and the colour that marks it agree.
 */
export const MILESTONE_REMINDER_DAYS = 14;

/**
 * True when a milestone is close enough to be worth surfacing as a reminder.
 *
 * **Overdue counts.** Something past its date is more urgent, not less, and
 * dropping it would quietly hide real work behind a window meant to reduce
 * noise.
 *
 * **Undated milestones do not.** A milestone with no due date cannot be due
 * inside any window, and these are exactly the bulk that made the surface
 * unreadable. They stay visible where they belong — under their rock, on the
 * Rocks page and on Home.
 */
export function isMilestoneDueSoon(
  due: string | null | undefined,
  from: Date = new Date(),
  days: number = MILESTONE_REMINDER_DAYS,
): boolean {
  if (!due) return false;
  return daysUntil(due, from) <= days;
}
