// Where the Export control sends its POST (components/export/export-control.tsx).
// Pure, so the page → URL mapping is testable without a browser.

/** The CSV endpoint for a page's view. `params` are its URL state; undefined values are dropped. */
export function exportUrl(
  exportId: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  return `/api/export/${encodeURIComponent(exportId)}${qs ? `?${qs}` : ""}`;
}

/** The To-Dos page's view as export params (mirrors its `?archived=` / `?owner=`). */
export function todosExportParams(view: {
  teamId: string;
  showArchived: boolean;
  ownerFilter: string;
}): Record<string, string | undefined> {
  return {
    team: view.teamId,
    archived: view.showArchived ? "1" : undefined,
    owner: view.ownerFilter !== "all" ? view.ownerFilter : undefined,
  };
}

/** Rocks and Headlines read the same `?archived=` / `?owner=` as To-Dos. */
export function teamListExportParams(view: {
  teamId: string;
  showArchived: boolean;
  ownerFilter: string;
}): Record<string, string | undefined> {
  return todosExportParams(view);
}

/** The Issues page's view, plus its Short-term / Long-term toggle (client state). */
export function issuesExportParams(view: {
  teamId: string;
  showArchived: boolean;
  ownerFilter: string;
  term: "short" | "long";
}): Record<string, string | undefined> {
  return {
    ...todosExportParams(view),
    term: view.term === "long" ? "long" : undefined,
  };
}

/**
 * The Scorecard's view: its URL state (`?period=`, `?weeks=`, `?archived=`)
 * plus the toolbar filters, which are client state in ScorecardPanel. Default
 * values are dropped so the URL stays short.
 */
export function scorecardExportParams(view: {
  teamId: string;
  period: string;
  weeks: number;
  showArchived: boolean;
  status: string;
  ownerId: string;
  group: string;
  sort: string;
  search: string;
}): Record<string, string | undefined> {
  const q = view.search.trim();
  return {
    team: view.teamId,
    period: view.period !== "weekly" ? view.period : undefined,
    weeks: view.weeks !== 13 ? String(view.weeks) : undefined,
    archived: view.showArchived ? "1" : undefined,
    status: view.status !== "all" ? view.status : undefined,
    owner: view.ownerId || undefined,
    group: view.group || undefined,
    sort: view.sort !== "order" ? view.sort : undefined,
    q: q || undefined,
  };
}

/** The Meetings page has no filters: the team's meeting history. */
export function meetingsExportParams(view: {
  teamId: string;
}): Record<string, string | undefined> {
  return { team: view.teamId };
}

/**
 * The Directory's view: search, Role and Team filters (client state in
 * DirectoryTable). Sets go out comma-joined and sorted, so the URL is stable.
 */
export function directoryExportParams(view: {
  query: string;
  access: ReadonlySet<string>;
  teams: ReadonlySet<string>;
}): Record<string, string | undefined> {
  const q = view.query.trim();
  const join = (s: ReadonlySet<string>) => (s.size > 0 ? [...s].sort().join(",") : undefined);
  return { q: q || undefined, access: join(view.access), teams: join(view.teams) };
}
