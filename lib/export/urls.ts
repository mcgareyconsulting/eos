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
