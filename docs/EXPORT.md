# Admin data export

Feedback row 55: admins need to export and print what a page shows, to hand
to auditors. An admin gets an **Export** menu on a page that has opted in.
It offers two formats:

- **Spreadsheet (.xlsx).** The server builds it and streams it back as a
  download.
- **Print / Save as PDF.** A print view opens in a new tab, and the browser's
  Print dialog saves it as a PDF. No headless browser runs on the server.
  The tab opens on a single-use link the server mints for that click (see
  [Print / PDF](#formats)).

Reference page: **To-Dos** (`/teams/{teamId}/todos`). Every page with a data
list is wired up; see [Pages](#pages) for each one's view, its columns and
what it leaves out, and for the pages that have no export and why.

## What every export guarantees

All of this lives in the shared core, `lib/export/run.ts`. A page cannot opt
out of any of it.

| # | Guardrail | Where |
|---|-----------|-------|
| 1 | Admin only, checked on the server for every request. The session must verify, the session claim must be admin, and a live Identity Platform read must still show `role: "admin"` on an account that is not disabled. Hiding the button is only a convenience. Non-admins get 403 from the API and 404 from the print view (the attempt is still audited, outcome `refused`). | `run.ts` `sessionUser` |
| 2 | Exactly the current view. The definition reads the page's own query parameters and runs the page's own queries for the signed-in admin, with the page's visibility predicate (`lib/todo-lists`, `lib/access` `accessFor`). An export never contains more than the UI shows. | `lib/export/pages/*.ts` |
| 3 | A provenance header goes at the top of the sheet and the top of the print view. It covers: export title, who exported it (name and email), when (Mountain time, `APP_TIME_ZONE` = America/Denver from `lib/time-zone.ts`, labeled MDT/MST), a note that every date and time in the file is Mountain time, the filters applied, the row count, and the app version (`DEPLOYMENT_ID` = git sha + Cloud Build id, plus the Cloud Run `K_REVISION`). | `provenance.ts` |
| 4 | One `audit_log` row per export (outcome `ok`), written **before** the file leaves the server. If that write fails, the export is refused (fail closed). Every signed-in attempt the core refuses is audited too (outcome `refused`, with a `reason`); see [Audit row](#audit-row). | `audit.ts` |
| 5 | Formula-injection protection (OWASP CSV injection). A cell starting with `=` `+` `-` `@`, tab, CR or LF (or their full-width forms) gets a leading `'`. This covers every string cell, headers and provenance included. Strings go out as inline strings, never as formulas. | `sanitize.ts`, `xlsx-writer.ts` |
| 6 | Nothing is persisted. The workbook is built in memory and streamed as the response, with `Cache-Control: no-store`. No Cloud Storage and no temp files. (A print token stores only which view to print, for two minutes, never its rows.) | `response.ts` |
| 7 | One shared module. A page supplies column definitions and a loader, nothing else. | `types.ts`, `registry.ts` |
| 8 | Values are normalized by column kind: rich text becomes plain text, user ids become display names, and dates and times use one format. A **row cap** of 5,000 refuses a larger view with "narrow the filters". It never truncates, because a partial file handed to an auditor is worse than none. Loaders stop early: a query that is the view reads at most 5,001 docs (`readCapped`), and an in-memory-filtered view is checked (`checkRowCap`) before any per-row sub-read. The core re-checks after `load`, before resolving names. | `normalize.ts`, `cap.ts` |

### Formats

- **`.xlsx`**: `POST /api/export/{id}?<page params>`. It is a POST so that a
  cross-site link or a prefetch cannot start an export, and its audit row,
  in an admin's browser. A cross-site `Origin` is also refused. The writer is
  in-house (`lib/export/xlsx-writer.ts`, about 300 lines, counterpart of the
  reader in `lib/xlsx.ts`). An .xlsx is a ZIP of six small XML files and Node
  ships DEFLATE. The SheetJS npm package is stale. exceljs would add a large
  transitive tree to the runtime image for features exports never use. Tests
  read every file the writer produces back through the in-house reader.
- **Print / PDF**: two steps, so the print view is never a state-changing
  GET. Rendering it reads the view and writes the audit row, and a
  cross-site link opened by a signed-in admin would carry the session cookie
  (it is `SameSite=Lax`, which top-level navigations send). So:
  1. The Export control opens a blank tab (inside the click, so pop-up
     blockers allow it), then calls
     `POST /api/export/{id}/print-token?<page params>`. That route refuses a
     cross-site `Origin`, re-checks the admin, the page and the parameters,
     and mints a token: 32 random bytes, stored only as its SHA-256 in
     `export_print_tokens`, bound to the admin's uid, the export id and the
     exact query string, valid for **2 minutes**. It answers
     `{ url: "/print/{id}?t=<token>" }`. Minting reads no rows and writes no
     `ok` audit row (refusals are audited).
  2. The tab goes to `GET /print/{id}?t=<token>`. The page spends the token
     (`delete({ exists: true })`, so only one of two racing requests wins;
     an expired or mismatched token is burned too) and renders the view the
     token names. Its own URL carries no view parameters. A missing,
     expired, reused or mismatched token gets "This print link has expired
     or was already used", status 410, audited. A `Sec-Fetch-Site` of
     `cross-site` or `same-site` is refused the same way, without spending
     the token (defense in depth; the token is the gate). Non-admins and
     unknown pages get a 404. Reloading the tab after it has printed shows
     the expired message: choose Print again on the page.

  `export_print_tokens` is Admin SDK only (`firestore.rules`
  `allow read, write: if false`) and skipped by the generic audit trigger
  (`functions/src/index.ts`), like `oauth_csrf_states`. `expires_at` is a
  Timestamp so a Firestore TTL policy can sweep tokens that were minted and
  never opened.

  The view sits outside the
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
| `date` | A real spreadsheet date cell (Excel serial, number format `yyyy-mm-dd`). A stored calendar day passes through. An instant becomes its Mountain-time day. Print shows `YYYY-MM-DD`. |
| `datetime` | A real spreadsheet date-time cell (Excel serial of the Mountain wall-clock time, format `yyyy-mm-dd hh:mm`). Print shows `YYYY-MM-DD HH:mm MDT` (or `MST`). |
| `boolean` | `Yes` / `No` |
| `user` | display name. `Unassigned` for none, `—` for an id with no profile (same as the UI) |
| `number` | a numeric cell |

Date cells are numbers, so they sort and filter as dates and can't carry a
formula. A value a spreadsheet can't date reliably (not a real day, or before
1900-03-01, where Excel's 1900 leap-year bug shifts serials) stays a text
cell, which still goes through formula-injection protection.

### Audit row

```
entity_type  "data_export"
action       "data_export"
entity_id    export id, e.g. "todos" (as requested, truncated, on refusals)
actor_uid    who exported, or tried to
actor_source "app"
team_id      team of the view, or null
outcome      "ok" | "refused"
reason       null when ok; otherwise one of the reasons below
http_status  200, or the refusal's status
export       { page, format: "xlsx" | "print", filters: {Label: value},
               row_count (null when never counted), app_version,
               query (refusals only: the requested query string, truncated) }
timestamp    server time
```

| `reason` | Status | When |
|----------|--------|------|
| `not_admin` | 403 | signed in, not an admin (the print view shows a 404) |
| `unknown_export` | 404 | no page with that export id |
| `bad_params` | 400 | the definition rejected the parameters |
| `not_found` | 404 | the team doesn't exist or isn't visible |
| `over_cap` | 413 | more than 5,000 rows |
| `print_token_missing` / `print_token_invalid` / `print_token_expired` / `print_token_mismatch` | 410 | print view: no token; unknown or already used; past its 2 minutes; minted for another admin or export |
| `cross_site` | 410 | print view reached by a navigation from another site |

`ok` rows fail closed (no row, no file). `refused` rows are best effort: the
request is refused either way, so a failed write is logged, not surfaced. No
session (401) has no actor and writes nothing. A cross-site POST is refused
by the route's `Origin` check before the session is read, so it isn't
audited either (it arrives without the `SameSite=Lax` cookie anyway). The
print token itself is never written to the audit trail.

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
     404 refusal. Honor the row cap early with `lib/export/cap.ts`: when a
     query is exactly the view, read it with `readCapped(query)` (at most
     5,001 docs; refuse on the extra one). When the page filters a query's
     docs in memory (as To-Dos does), a limit would refuse views that fit, so
     call `checkRowCap(rows.length)` on the filtered rows instead, and do it
     **before** any per-row sub-read (milestones per rock, comments per item). Return `filters` (one `{label, value}` per filter shown on the
     page, using names, not ids), `teamId`, `fileNameParts`, and `names` (the
     roster map, so `user` columns don't re-read `/users`).
   - `columns` can also come back on the loaded view when they depend on
     it (the Scorecard's period columns follow its Weekly/Monthly tab and
     week range). The definition still declares its fixed columns, which the
     snapshot test pins.
   - Shared team-page pieces (the `team` param, the team gate, the roster,
     `?owner=`) are in `lib/export/pages/shared.ts`.
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
   When part of the view is client state (a toggle or a toolbar filter),
   render the control in the client component that holds that state and pass
   it as params too (Issues, Scorecard and Directory do this).
4. **Tests** in `lib/export/pages/{page}.test.ts`:
   - a column snapshot (`[key, header, kind]` for every column);
   - the view: each filter, the ordering, and that rows the page hides from
     a non-admin viewer are not returned;
   - the params round-trip.

   The admin gate, injection and audit tests live in `lib/export/run.test.ts`
   and cover every page through the core (one test walks every registered
   id and checks a non-admin is refused before its loader runs). Add a
   page-specific case there only if the page adds behavior. Page tests that
   go through the core use `lib/test-support/export-deps.ts`.

## Pages

Every export is the view on screen: the URL state, plus any client-side
toggle or filter the control passes along. Rows come out in the page's
order through the page's own functions, which were moved to `lib/` where
they lived in a component.

| Page | Export id | View (params) | Order and shared rule | Control |
|------|-----------|---------------|------------------------|---------|
| To-Dos | `todos` | `team`, `archived`, `owner` | owner cards in speaking order, open then done (`lib/todo-board-order.ts`) | header |
| Rocks | `rocks` | `team`, `archived`, `owner` | Company, Team, members A–Z, off-roster owners, Shared by (`lib/rocks-view.ts`, `lib/rocks-share.ts`) | header |
| Issues | `issues` | `team`, `archived`, `owner`, `term` (Short-/Long-term toggle) | `rankShortTerm` / `rankLongTerm` (`lib/issues.ts`) | term toggle row |
| Headlines | `headlines` | `team`, `archived`, `owner` | owner groups then Cascading; Archived flat, newest first (`lib/headlines.ts`) | header |
| Scorecard | `scorecard` | `team`, `period`, `weeks`, `archived`, and the toolbar's `status`, `owner`, `group`, `sort`, `q` | the toolbar's filter and sort (`lib/scorecard-view.ts`), then the grid's grouping (`bucketMetricsByGroup` + `orderGroupNames`) | toolbar |
| Meetings | `meetings` | `team` (the page has no filters) | newest first (`lib/l10/meeting-summary.ts`) | header |
| Directory | `directory` | `q`, `access`, `teams` (comma-joined sets) | the loader's last-name order, the table's filter (`lib/directory-filter.ts`) | admin toolbar |

### What each file holds, and leaves out

- **To-Dos**: the team's To-Dos list, as the tabs count it. It leaves out
  two per-viewer reminder boxes: "Your milestones" (rock milestones, which
  belong to the Rocks export) and "Assigned to me from other teams" (which
  belong to the other teams' exports).
- **Rocks**: one row per rock, its milestones in one cell (a line each, due
  order, `[done]`/`[open]`, owner, due date) plus a done count. A member's
  block (their milestones on another team's non-private rock, spec §4) is a
  row of its own, entry "Milestones on another team's rock", with only the
  headline and that member's milestones, as the page shows it. Audience
  rocks and blocks are on the Active view only, as on the page. Status
  history (behind a click) is not in the file.
- **Issues**: the selected term only, the list the toggle shows.
- **Headlines**: the Owner column names the creator. The page says "You"
  on the viewer's own rows; a file handed to someone else names the person.
  Names come from the team roster, as on the page.
- **Scorecard**: the fixed columns, then one per period the grid shows,
  newest first, holding the stored number. A Yes/No is 1 or 0 and a time is
  minutes; the Unit column says which. The goal reads in words ("At least
  5"), not as a comparator that would look like a formula. The viewer's own
  measurables lead within each group, as on the page.
- **Meetings**: the History list. Meeting settings (agendas, Meet link,
  speaking order) are configuration, not history, and each meeting's recap
  is its own page. A live meeting has no rating, as on the page.
- **Directory**: the admin's view of the table, so it includes deactivated
  people and the admin-only account state (No account / Never signed in).

### Pages with no export

- **Home**: a per-viewer dashboard of the viewer's own rocks, to-dos and
  measurables from every team. Each item is already in its team page's
  export, which is the record an auditor asks for.
- **Notifications**: the viewer's personal inbox, not organization data.
- **Admin** (`/admin` redirects to `/admin/import`), team import, new team,
  Directory → new person: forms and import tools, no list of records.
- **Integrations, Settings**: per-user settings.
- **A single meeting** (`/meetings/{id}`, the live L10 or its recap): one
  record, not a list; its items are in the Rocks, To-Dos, Issues and
  Headlines exports.

Out of scope for this work, at the user's direction: the admin tracker, the
scheduled two-way sync, and feedback item 46.
