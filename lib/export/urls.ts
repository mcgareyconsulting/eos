// Where the Export control sends each format (components/export/export-control.tsx).
// Pure, so the page → URL mapping is testable without a browser.

/**
 * `params` are the page's own URL state; undefined values are dropped.
 *
 *   xlsx        POST → the spreadsheet download
 *   printToken  POST → `{ url }`, a single-use print-view link
 *               (lib/export/print-token.ts); the print page itself takes
 *               no view parameters, only that token
 */
export function exportUrls(
  exportId: string,
  params: Readonly<Record<string, string | undefined>>,
): { xlsx: string; printToken: string } {
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  const id = encodeURIComponent(exportId);
  const suffix = qs ? `?${qs}` : "";
  return {
    xlsx: `/api/export/${id}${suffix}`,
    printToken: `/api/export/${id}/print-token${suffix}`,
  };
}

/** The print view for a minted token — what the print-token route answers. */
export function printViewUrl(exportId: string, token: string): string {
  return `/print/${encodeURIComponent(exportId)}?t=${encodeURIComponent(token)}`;
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
