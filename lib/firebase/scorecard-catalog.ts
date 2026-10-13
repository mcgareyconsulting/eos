import { getOrgTeams } from "./teams";
import { addDays, toDateString } from "@/lib/dates";
import { loadScorecardEntries } from "@/lib/scorecard-entries";
import { loadUserNames } from "./user-names";
import { STRIP_LENGTH, type GoalDirection } from "@/lib/scorecard";
import {
  inCatalogFor,
  isArchivedMetric,
  isHomeTeam,
  isPublicMetric,
  isSharedIntoTeam,
} from "@/lib/scorecard-share";
import type { ScorecardMetricDoc } from "@/lib/firestore-types";

/**
 * One row in the org-wide "Add existing" picker.
 *
 * `teamName` is carried rather than looked up in the client, because the
 * whole point of the picker is that it lists measurables from teams the
 * viewer may not belong to — there is no roster on the client to resolve an
 * unfamiliar team id against, and "Total Teller Transactions" means nothing
 * without knowing whose it is.
 */
/**
 * How far back the picker looks for recent values.
 *
 * 26 weeks is a compromise across intervals, since a single query bound has to
 * serve all of them: it gives a weekly measurable more history than the strip
 * can show, a monthly one about six points, and a quarterly one two. Widening
 * it costs a proportionally bigger read on every open, for points the strip
 * would then have to drop anyway.
 */
const LOOKBACK_DAYS = 26 * 7;

export type CatalogMetric = {
  id: string;
  name: string;
  unit: string;
  goal: number | null;
  /** Needed with `goal` to decide on/off track — a goal alone cannot. */
  direction: GoalDirection;
  interval: string;
  teamId: string;
  teamName: string;
  /**
   * The person accountable for reporting this measurable, resolved from
   * `/users` rather than a team roster.
   *
   * The roster route is the one that breaks here: `getTeamMembers` only knows
   * the asking team, and by design this list is mostly measurables from teams
   * the viewer is not on — so every owner outside their own team would resolve
   * to nothing. That is exactly the "Shared by —" bug `lib/user-name.ts`
   * documents, in a new place. Empty string when no profile has been written
   * yet; the row picks the fallback.
   */
  ownerName: string;
  /**
   * The most recent periods that have a value, newest first, at most
   * `STRIP_LENGTH`. Empty periods are **not** padded in: across four intervals
   * a "missing" cell would mean four different spans of time, and a monthly
   * measurable would look mostly unreported next to a weekly one. The strip
   * says "the last N times this was recorded", which is true at every
   * interval.
   */
  recent: { period: string; value: number }[];
  /** Already on the asking team's scorecard, by ownership or by an existing share. */
  alreadyOnScorecard: boolean;
  /** Owned by the asking team, so it can never be added or hidden. */
  isHome: boolean;
  /** Public metrics are listed for every team and trackable; private ones only reach a catalog via their own team. */
  isPublic: boolean;
};

/**
 * The measurables a team may browse in "Add existing", labelled with the team
 * each belongs to.
 *
 * **Filtered by visibility** (docs/PERMISSIONS_SPEC.md 3.4). A row is listed
 * when the metric is public, or when it belongs to the asking team, or the
 * caller is an org admin (who sees every metric). A private metric of another
 * team never appears — not even its name. This supersedes the 2026-09-09
 * "deliberately unfiltered" decision, under which any member saw every
 * measurable in the org.
 *
 * Adding grants a read only; every write stays with the home team (see
 * `lib/scorecard-share.ts`), and only a public metric can be tracked
 * (`addExistingMetric` enforces it).
 *
 * Runs on the Admin SDK, so it bypasses `firestore.rules` by construction.
 * Call it only from a server action that has already established the caller
 * may act on the asking team.
 *
 * **Active only.** Archived measurables are filtered out here — pulling one
 * onto a scorecard would put a row there that its own team has already
 * retired, and it would arrive invisible, since the scorecard filters archived
 * rows out too. Restoring is the owning team's call.
 */
export async function loadOrgMetricCatalog(
  db: FirebaseFirestore.Firestore,
  teamId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<CatalogMetric[]> {
  return loadCatalog(db, teamId, (m) =>
    inCatalogFor(m, teamId, opts.isAdmin === true),
  );
}

async function loadCatalog(
  db: FirebaseFirestore.Firestore,
  teamId: string,
  keep: (m: ScorecardMetricDoc) => boolean,
): Promise<CatalogMetric[]> {
  const [snap, teams] = await Promise.all([
    db.collection("scorecard_metrics").get(),
    getOrgTeams(),
  ]);

  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const active = snap.docs.filter(
    (d) =>
      !isArchivedMetric(d.data() as ScorecardMetricDoc) &&
      keep(d.data() as ScorecardMetricDoc),
  );

  // One extra read, on modal open only, to give each row a trend instead of a
  // bare name. Deciding whether to pull a measurable onto your scorecard is a
  // question about its shape — "is this reported, and is it healthy" — which a
  // name and a goal cannot answer.
  const entries = await loadScorecardEntries(
    db,
    active.map((d) => d.id),
    toDateString(addDays(new Date(), -LOOKBACK_DAYS)),
  );

  // Owner names come from /users, not a roster — most owners in this list are
  // on teams the viewer does not belong to. See loadUserNames.
  const ownerName = await loadUserNames(
    db,
    active.map((d) => String((d.data() as ScorecardMetricDoc).owner_id ?? "")),
  );

  const recentByMetric = new Map<string, { period: string; value: number }[]>();
  for (const e of entries) {
    if (e.value == null) continue;
    const list = recentByMetric.get(e.metric_id);
    if (list) list.push({ period: e.week_start_date, value: e.value });
    else recentByMetric.set(e.metric_id, [{ period: e.week_start_date, value: e.value }]);
  }
  for (const list of recentByMetric.values()) {
    list.sort((a, b) => b.period.localeCompare(a.period));
    list.splice(STRIP_LENGTH);
  }

  return active
    .map((d) => {
      const x = d.data() as ScorecardMetricDoc;
      const home = String(x.team_id ?? "");
      const shareable = {
        team_id: home,
        shared_team_ids: x.shared_team_ids,
        is_public: x.is_public,
      };
      return {
        id: d.id,
        name: String(x.name ?? ""),
        unit: String(x.unit ?? "number"),
        goal: x.goal ?? null,
        direction: (x.direction ?? "gte") as GoalDirection,
        interval: String(x.interval ?? "weekly"),
        recent: recentByMetric.get(d.id) ?? [],
        teamId: home,
        teamName: teamName.get(home) ?? "Unknown team",
        ownerName: ownerName.get(String(x.owner_id ?? "")) ?? "",
        alreadyOnScorecard:
          isHomeTeam(shareable, teamId) || isSharedIntoTeam(shareable, teamId),
        isHome: isHomeTeam(shareable, teamId),
        isPublic: isPublicMetric(shareable),
      };
    })
    .sort(
      (a, b) =>
        a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name),
    );
}
