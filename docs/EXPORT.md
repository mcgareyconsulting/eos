# Admin data export

Feedback row 55: admins need to export and print what a page shows, to hand
to auditors. An admin gets an **Export** menu on a page that has opted in.
It offers two formats:

- **Spreadsheet (.xlsx).** The server builds it and streams it back as a
  download.
- **Print / Save as PDF.** A print view opens in a new tab, and the browser's
  Print dialog saves it as a PDF. No headless browser runs on the server.

Reference page: **To-Dos** (`/teams/{teamId}/todos`). No other page is wired up yet.

## What every export guarantees

All of this lives in the shared core, `lib/export/run.ts`. A page cannot opt
out of any of it.

| # | Guardrail | Where |
|---|-----------|-------|
| 1 | Admin only, checked on the server for every request. The session must verify, the session claim must be admin, and a live Identity Platform read must still show `role: "admin"` on an account that is not disabled. Hiding the button is only a convenience. Non-admins get 403 from the API and 404 from the print view. | `run.ts` `sessionUser` |
| 2 | Exactly the current view. The definition reads the page's own query parameters and runs the page's own queries for the signed-in admin, with the page's visibility predicate (`lib/todo-lists`, `lib/access` `accessFor`). An export never contains more than the UI shows. | `lib/export/pages/*.ts` |
| 3 | A provenance header goes at the top of the sheet and the top of the print view. It covers: export title, who exported it (name and email), when (America/Chicago, with the CDT/CST zone), the filters applied, the row count, and the app version (`DEPLOYMENT_ID` = git sha + Cloud Build id, plus the Cloud Run `K_REVISION`). | `provenance.ts` |
| 4 | One `audit_log` row per export, written **before** the file leaves the server. If that write fails, the export is refused (fail closed). | `audit.ts` |
| 5 | Formula-injection protection (OWASP CSV injection). A cell starting with `=` `+` `-` `@`, tab, CR or LF (or their full-width forms) gets a leading `'`. This covers every string cell, headers and provenance included. Strings go out as inline strings, never as formulas. | `sanitize.ts`, `xlsx-writer.ts` |
| 6 | Nothing is persisted. The workbook is built in memory and streamed as the response, with `Cache-Control: no-store`. No Cloud Storage and no temp files. | `response.ts` |
| 7 | One shared module. A page supplies column definitions and a loader, nothing else. | `types.ts`, `registry.ts` |
| 8 | Values are normalized by column kind: rich text becomes plain text, user ids become display names, and dates and times use one format. A **row cap** of 5,000 refuses a larger view with "narrow the filters". It never truncates, because a partial file handed to an auditor is worse than none. | `normalize.ts`, `run.ts` `EXPORT_ROW_CAP` |

### Formats

- **`.xlsx`**: `POST /api/export/{id}?<page params>`. It is a POST so that a
  cross-site link or a prefetch cannot start an export, and its audit row,
  in an admin's browser. A cross-site `Origin` is also refused. The writer is
  in-house (`lib/export/xlsx-writer.ts`, about 300 lines, counterpart of the
  reader in `lib/xlsx.ts`). An .xlsx is a ZIP of six small XML files and Node
  ships DEFLATE. The SheetJS npm package is stale. exceljs would add a large
  transitive tree to the runtime image for features exports never use. Tests
  read every file the writer produces back through the in-house reader.
- **Print / PDF**: `GET /print/{id}?<page params>`. This sits outside the
  `(app)` group, so the print view has no sidebar. It always renders light.
  The table header repeats on every printed page, rows don't split across
  pages, and the toolbar is hidden on paper. The print rules are in
  `components/export/print-sheet.tsx` and the `@media print` block in
  `app/globals.css`. Rendering the view *is* the export, so it writes the
  audit row with format `print`.

### Value formats

| Kind | Output |
|------|--------|
| `text` | trimmed string |
| `richtext` | `lib/rich-text.ts` `richTextToPlain`: bold dropped, links as `label (url)`, bullets as `• ` |
| `date` | `YYYY-MM-DD`. A stored calendar day passes through. An instant becomes its Chicago day. |
| `datetime` | `YYYY-MM-DD HH:mm CDT` (or `CST`), America/Chicago |
| `boolean` | `Yes` / `No` |
| `user` | display name. `Unassigned` for none, `—` for an id with no profile (same as the UI) |
| `number` | a numeric cell |

### Audit row

```
entity_type  "data_export"
action       "data_export"
entity_id    export id, e.g. "todos"
actor_uid    the admin
actor_source "app"
team_id      team of the view, or null
export       { page, format: "xlsx" | "print", filters: {Label: value}, row_count, app_version }
timestamp    server time
```

The row is written the same way as `lib/access-audit.ts` rows: an Admin SDK
write straight into `audit_log`. The generic audit trigger skips that
collection. No rules change was needed: `audit_log` stays `allow write: if false`.

## Adding a page

You add configuration only. The core, routes, writer and print view do not change.

1. **Write a definition**: `lib/export/pages/{page}.ts`, exporting an
   `ExportDefinition<Row, Params>` (see `lib/export/types.ts`;
   `lib/export/pages/todos.ts` is the model).
   - `id`: the URL id, which is also the audit `entity_id`. `title`: the
     heading and sheet name.
   - `parseParams(searchParams)`: read the **same query parameter names the
     page's server component reads**, plus `team` for team pages (the path
     segment). Validate ids. Return `{ ok: false, status: 400, ... }` for junk.
   - `load({ db, uid, viewer }, params)`: run the **page's own queries** and
     apply the **page's own visibility predicate**, then `accessFor(type).canSee`.
     Return the rows in the order the page renders them. A missing team is a
     404 refusal. Return `filters` (one `{label, value}` per filter shown on the
     page, using names, not ids), `teamId`, `fileNameParts`, and `names` (the
     roster map, so `user` columns don't re-read `/users`).
   - `columns`: `{ key, header, kind, value(row), width? }`. Choose a `kind`;
     don't format values yourself. Align `key`s with stored field names and
     `lib/item-registry.ts` vocabulary (owner, assigner, …).
   - If the page's ordering or filtering lives in a client component, move
     that pure function into `lib/` and import it from both, so the board and
     the export can't drift. To-Dos did this with `lib/todo-board-order.ts`.
2. **Register it** in `lib/export/registry.ts`.
3. **Add the control**: render
   `<ExportControl exportId="{id}" params={...} />` (from
   `components/export/export-control.tsx`) on the page, **only when
   `isAdmin`**. Pass the page's current URL state with the same keys
   `parseParams` reads. Put a small `xxxExportParams(view)` helper in
   `lib/export/urls.ts` and test that it round-trips through `parseParams`.
   Team entity pages put the control in `EntityPageHeader`'s `leading` slot.
4. **Tests** in `lib/export/pages/{page}.test.ts`:
   - a column snapshot (`[key, header, kind]` for every column);
   - the view: each filter, the ordering, and that rows the page hides from
     a non-admin viewer are not returned;
   - the params round-trip.

   The admin gate, injection and audit tests live in `lib/export/run.test.ts`
   and cover every page through the core. Add a page-specific case there
   only if the page adds behavior.

## Not in the To-Dos export (by design)

The To-Dos file is the team's **To-Dos list**, as the tabs count it. It
leaves out two per-viewer reminder boxes on that page:

- "Your milestones": rock milestones. These belong to the Rocks export.
- "Assigned to me from other teams": these belong to the other teams' exports.
