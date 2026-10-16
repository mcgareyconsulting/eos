// Where the Export control sends each format (components/export/export-control.tsx).
// Pure, so the page → URL mapping is testable without a browser.

/** `params` are the page's own URL state; undefined values are dropped. */
export function exportUrls(
  exportId: string,
  params: Readonly<Record<string, string | undefined>>,
): { xlsx: string; print: string } {
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  const id = encodeURIComponent(exportId);
  const suffix = qs ? `?${qs}` : "";
  return { xlsx: `/api/export/${id}${suffix}`, print: `/print/${id}${suffix}` };
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
