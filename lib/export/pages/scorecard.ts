// Export definition: a team's Scorecard (app/(app)/teams/[teamId]/scorecard).
//
// Reads the page's URL state (`?period=`, `?weeks=`, `?archived=1`, plus
// `team`) and the toolbar filters, which are client state in ScorecardPanel
// (`status`, `owner`, `group`, `sort`, `q`), so the Export control there
// passes them along. Loads what page.tsx loads — the team's own measurables
// and the ones it tracks, deduped; its groups; the entries for the visible
// period columns — and runs the panel's own rules (lib/scorecard-view.ts) and
// the grid's grouping (lib/scorecard.ts bucketMetricsByGroup with
// orderGroupNames): ungrouped rows first, then each group in its configured
// order, or one flat list when the toolbar flattens the grid. Measurables are
// double-checked against the access module.
//
// Columns follow the view: the fixed ones below, then one per period the grid
// shows, newest first, holding the stored number (a Yes/No is 1 or 0, a time
// is minutes; the Unit column says which).

import { accessFor } from "@/lib/access";
import type { ScorecardMetricDoc } from "@/lib/firestore-types";
import { loadScorecardGroups } from "@/lib/firebase/scorecard-groups";
import { loadUserNames } from "@/lib/firebase/user-names";
import {
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  TREND_STATUS_LABEL,
  average,
  bucketMetricsByGroup,
  parseWeekRange,
  trendStatus,
  type GoalDirection,
  type SortOption,
  type StatusFilter,
  type WeekRange,
} from "@/lib/scorecard";
import { entriesToRecord, loadScorecardEntries } from "@/lib/scorecard-entries";
import {
  defaultGroupName,
  orderGroupNames,
  type ScorecardGroup,
} from "@/lib/scorecard-groups";
import {
  PERIOD_LABELS,
  buildScorecardColumns,
  normalizeMetricInterval,
  oldestPeriodStart,
  parseScorecardPeriod,
  type ScorecardColumn,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { isArchivedMetric, metricGroupForTeam } from "@/lib/scorecard-share";
import {
  filterAndSortScorecard,
  metricsForPeriod,
  scorecardFlatList,
  type ScorecardToolbar,
} from "@/lib/scorecard-view";
import { UNIT_OPTIONS } from "@/app/(app)/teams/[teamId]/scorecard/metric-form-options";
import {
  isRefusal,
  type ExportColumn,
  type ExportDefinition,
  type ExportRefusal,
  type LoadedView,
} from "../types";
import { checkRowCap } from "../cap";
import { loadRoster, loadTeamOr404, parseTeamParam, type Member } from "./shared";

export type ScorecardExportParams = {
  teamId: string;
  period: ScorecardPeriod;
  weeks: WeekRange;
  archived: boolean;
  toolbar: ScorecardToolbar;
};

/** A measurable as the page maps it (page.tsx), plus where and how it renders. */
export type ScorecardExportMetric = {
  id: string;
  name: string;
  unit: string;
  goal: number | null;
  direction: GoalDirection;
  owner_id: string | null;
  group: string | null;
  interval: string;
  sectionName: string;
  sort_order: number;
  team_id: string;
  sharedFrom: string | null;
};

export type ScorecardExportRow = ScorecardExportMetric & {
  /** The heading it renders under; blank in a flat list or the unheaded block. */
  section: string;
  /** One per period column, newest first, null where nothing is logged. */
  values: (number | null)[];
};

const SORTS = new Set<string>(SORT_OPTIONS.map((o) => o.value));
const STATUSES = new Set<string>(STATUS_FILTER_OPTIONS.map((o) => o.value));
const capped = (v: string | null, n: number) => (v && v.length <= n ? v : "");

export function parseScorecardParams(
  sp: URLSearchParams,
): ScorecardExportParams | ExportRefusal {
  const teamId = parseTeamParam(sp);
  if (isRefusal(teamId)) return teamId;
  const status = sp.get("status") ?? "all";
  const sort = sp.get("sort") ?? "order";
  return {
    teamId,
    period: parseScorecardPeriod(sp.get("period")),
    weeks: parseWeekRange(sp.get("weeks")),
    // page.tsx: `sp.archived === "1"` (not "true", unlike the other tabs).
    archived: sp.get("archived") === "1",
    toolbar: {
      status: (STATUSES.has(status) ? status : "all") as StatusFilter,
      ownerId: capped(sp.get("owner"), 128),
      group: capped(sp.get("group"), 200),
      sort: (SORTS.has(sort) ? sort : "order") as SortOption,
      search: capped(sp.get("q"), 200),
    },
  };
}

/**
 * The rows the grid renders for this view, in its order. Pure: `metrics` is
 * the page's mapped list (active or archived, every interval).
 */
export function scorecardViewRows(input: {
  metrics: readonly ScorecardExportMetric[];
  period: ScorecardPeriod;
  columns: readonly ScorecardColumn[];
  entries: Readonly<Record<string, number | null>>;
  toolbar: ScorecardToolbar;
  groups: readonly ScorecardGroup[];
  members: readonly Member[];
  viewerId: string;
}): ScorecardExportRow[] {
  const valuesFor = (id: string) =>
    input.columns.map((c) => input.entries[`${id}__${c.id}`] ?? null);
  const filtered = filterAndSortScorecard(metricsForPeriod(input.metrics, input.period), input.toolbar, {
    valuesFor,
    members: input.members,
    viewerId: input.viewerId,
  });
  // scorecard-grid.tsx: the same bucketing, ungrouped rows leading unheaded.
  const { ungrouped, groups } = bucketMetricsByGroup(
    filtered,
    scorecardFlatList(input.toolbar),
    (names) => orderGroupNames(names, [...input.groups], input.period),
    (m) => m.sectionName ?? m.group,
  );
  const row = (m: ScorecardExportMetric, section: string): ScorecardExportRow => ({
    ...m,
    section,
    values: valuesFor(m.id),
  });
  return [
    ...ungrouped.map((m) => row(m, "")),
    ...groups.flatMap((g) => g.items.map((m) => row(m, g.name))),
  ];
}

const UNIT_LABEL = new Map(UNIT_OPTIONS.map((o) => [o.value, o.label]));
const UNIT_NOTE: Record<string, string> = { yesno: " (1 = Yes, 0 = No)", time: " (minutes)" };

/** "At least 5", "At most 2", "Exactly 1" — the form's wording, with the stored number. */
export function goalText(goal: number | null, direction: GoalDirection): string {
  if (goal == null) return "No goal";
  const word = direction === "gte" ? "At least" : direction === "lte" ? "At most" : "Exactly";
  return `${word} ${goal}`;
}

export const SCORECARD_COLUMNS: readonly ExportColumn<ScorecardExportRow>[] = [
  { key: "section", header: "Group", kind: "text", value: (m) => m.section, width: 18 },
  { key: "name", header: "Measurable", kind: "text", value: (m) => m.name, width: 40 },
  { key: "owner", header: "Owner", kind: "user", value: (m) => m.owner_id, width: 22 },
  {
    key: "goal",
    header: "Goal",
    kind: "text",
    value: (m) => goalText(m.goal, m.direction),
    width: 14,
  },
  {
    key: "unit",
    header: "Unit",
    kind: "text",
    value: (m) => `${UNIT_LABEL.get(m.unit) ?? m.unit}${UNIT_NOTE[m.unit] ?? ""}`,
    width: 14,
  },
  {
    key: "status",
    header: "Status",
    kind: "text",
    value: (m) => TREND_STATUS_LABEL[trendStatus(m.values, m.goal, m.direction)],
    width: 11,
  },
  { key: "average", header: "Average", kind: "number", value: (m) => average(m.values), width: 10 },
  {
    key: "shared_from",
    header: "Tracked from",
    kind: "text",
    value: (m) => m.sharedFrom,
    width: 18,
  },
  { key: "id", header: "Measurable ID", kind: "text", value: (m) => m.id, width: 24 },
];

/** The fixed columns plus one per period the grid shows (newest first). */
export function scorecardColumnsFor(
  columns: readonly ScorecardColumn[],
): ExportColumn<ScorecardExportRow>[] {
  return [
    ...SCORECARD_COLUMNS,
    ...columns.map(
      (c, i): ExportColumn<ScorecardExportRow> => ({
        key: `period:${c.id}`,
        header: c.label,
        kind: "number",
        value: (m) => m.values[i],
        width: 12,
      }),
    ),
  ];
}

/** page.tsx's mapping of a stored measurable, for team `tid`. */
export function mapScorecardMetric(
  x: ScorecardMetricDoc & { id: string },
  tid: string,
  teamName: (id: string) => string | undefined,
): ScorecardExportMetric {
  const home = String(x.team_id ?? tid);
  const group = metricGroupForTeam({ ...x, team_id: home }, tid);
  return {
    id: x.id,
    name: x.name,
    unit: x.unit,
    goal: x.goal ?? null,
    direction: x.direction,
    owner_id: x.owner_id ?? null,
    group,
    interval: x.interval ?? "weekly",
    sectionName: group ?? defaultGroupName(normalizeMetricInterval(x.interval)),
    sort_order: x.sort_order ?? 0,
    team_id: home,
    sharedFrom: home !== tid ? (teamName(home) ?? "Another team") : null,
  };
}

function toolbarFilters(t: ScorecardToolbar, names: ReadonlyMap<string, string>) {
  const label = <T extends { value: string; label: string }>(opts: readonly T[], v: string) =>
    opts.find((o) => o.value === v)?.label ?? v;
  return [
    { label: "Status", value: label(STATUS_FILTER_OPTIONS, t.status) },
    { label: "Owner", value: t.ownerId ? (names.get(t.ownerId) ?? "—") : "All owners" },
    { label: "Group", value: t.group || "All groups" },
    { label: "Sort", value: label(SORT_OPTIONS, t.sort) },
    { label: "Search", value: t.search.trim() || "(none)" },
  ];
}

export const scorecardExport: ExportDefinition<ScorecardExportRow, ScorecardExportParams> = {
  id: "scorecard",
  title: "Scorecard",
  parseParams: parseScorecardParams,
  columns: SCORECARD_COLUMNS,
  async load({ db, uid, viewer }, p): Promise<LoadedView<ScorecardExportRow> | ExportRefusal> {
    const teamDoc = await loadTeamOr404(db, p.teamId, viewer);
    if (isRefusal(teamDoc)) return teamDoc;
    const teamName = teamDoc.name;

    // page.tsx: two queries (Firestore cannot OR them), merged by id.
    const [members, ownedSnap, sharedSnap, teamsSnap, groups] = await Promise.all([
      loadRoster(db, p.teamId),
      db.collection("scorecard_metrics").where("team_id", "==", p.teamId).get(),
      db.collection("scorecard_metrics").where("shared_team_ids", "array-contains", p.teamId).get(),
      db.collection("teams").get(),
      loadScorecardGroups(db, p.teamId),
    ]);
    const teamNames = new Map(
      teamsSnap.docs.map((d) => [d.id, (d.data()?.name as string) ?? "Team"]),
    );
    const byId = new Map<string, ScorecardMetricDoc & { id: string }>();
    for (const d of [...ownedSnap.docs, ...sharedSnap.docs]) {
      if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...(d.data() as ScorecardMetricDoc) });
    }
    const metrics = [...byId.values()]
      .filter(
        (x) =>
          accessFor("metric").canSee({ ...x, team_id: String(x.team_id ?? p.teamId) }, viewer) &&
          isArchivedMetric(x) === p.archived,
      )
      .map((x) => mapScorecardMetric(x, p.teamId, (id) => teamNames.get(id)))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    // Row cap (lib/export/cap.ts), early where it can be exact. The view is
    // these measurables filtered in memory, so the query can't carry a limit.
    // Without a status filter the toolbar's other filters need no entries,
    // so the row count is known now — refuse before reading any entries.
    // A status filter needs the entries; that view is checked once built.
    if (p.toolbar.status === "all") {
      const viewCount = filterAndSortScorecard(metricsForPeriod(metrics, p.period), p.toolbar, {
        valuesFor: () => [],
        members,
        viewerId: uid,
      }).length;
      const overCap = checkRowCap(viewCount);
      if (overCap) return overCap;
    }

    const columns = buildScorecardColumns(p.period, undefined, p.weeks);
    const entries = entriesToRecord(
      await loadScorecardEntries(
        db,
        metrics.map((m) => m.id),
        oldestPeriodStart(p.period, p.weeks),
      ),
    );

    // Roster first; borrowed measurables' owners from /users, as the page does.
    const names = new Map(members.map((m) => [m.user_id, m.full_name]));
    const offRoster = metrics
      .map((m) => m.owner_id ?? "")
      .filter((id) => id !== "" && !names.has(id));
    for (const [id, name] of await loadUserNames(db, offRoster)) names.set(id, name);

    const rows = scorecardViewRows({
      metrics,
      period: p.period,
      columns,
      entries,
      toolbar: p.toolbar,
      groups,
      members,
      viewerId: uid,
    });
    const overCap = checkRowCap(rows.length);
    if (overCap) return overCap;

    return {
      ok: true,
      rows,
      teamId: p.teamId,
      names,
      columns: scorecardColumnsFor(columns),
      filters: [
        { label: "Team", value: teamName },
        { label: "View", value: p.archived ? "Archived" : "Active" },
        { label: "Period", value: PERIOD_LABELS[p.period] },
        ...(p.period === "weekly" ? [{ label: "Weeks", value: String(p.weeks) }] : []),
        ...toolbarFilters(p.toolbar, names),
      ],
      fileNameParts: [teamName, p.period, p.archived ? "archived" : "active"],
    };
  },
};
