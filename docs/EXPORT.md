# Data export (CSV)

Feedback row 55: people need to export what a page shows, to hand to
auditors or to work with in Excel. Every page that has opted in shows an
**Export CSV** button.

- **Available to everyone; scoped to the viewer's permissions** (Daniel
  2026-10-16). Every signed-in user can export any wired page they can open,
  and the file holds exactly what that page shows *them*: never more. Admins
  get what admins see on the page.
- **CSV only** (Daniel 2026-10-16). The export is one `.csv` download. Open it
  in Excel; to print or make a PDF, print or save as PDF from Excel. There is
  no in-app print view and no `.xlsx` export.

Reference page: **To-Dos** (`/teams/{teamId}/todos`). No other page is wired
up on this branch.

## What every export guarantees

All of this lives in the shared core, `lib/export/run.ts`. A page cannot opt
out of any of it.

| # | Guardrail | Where |
|---|-----------|-------|
| 1 | **Who.** Checked on the server for every request, in this order, before any of the page's data is read: (a) the session verifies; (b) the account is live: a fresh Identity Platform read shows it still exists and is not disabled (deactivation disables it), and the admin claim is re-read from it rather than trusted from a cookie up to 25 hours old; (c) the page exists and its parameters parse; (d) the **page's own access rule** passes for this viewer (`definition.authorize`, e.g. To-Dos uses `checkTeamAccess`, the rule behind `requireTeamAccess`: on the roster or an org admin, and the team exists). Someone who can't open the page gets the page's own 404. The button being on the page is a convenience, not the gate. | `run.ts`, `lib/firebase/team-access.ts` |
| 2 | **What.** Exactly the current view for this viewer. The definition reads the page's own query parameters and runs the page's own queries with the page's visibility predicate (`lib/todo-lists`, `lib/access` `accessFor`) for the signed-in viewer. There is no "admin sees everything" shortcut the page doesn't have: a member's file has no one else's private to-dos and no other team's items. | `lib/export/pages/*.ts` |
| 3 | **Provenance**, without breaking the sheet. A CSV has no header block (extra rows above the table would break sorting and filtering), so provenance goes in the **file name**: `todos-leadership-active-2026-10-16-1305-MT.csv` (page, team, view, Mountain date and time; safe characters only). The **audit row** has the rest: who, the filters, the row count, the app version (`DEPLOYMENT_ID` = git sha + Cloud Build id, plus the Cloud Run `K_REVISION`) and the file name. | `provenance.ts`, `audit.ts` |
| 4 | **Audit.** One `audit_log` row per successful export, for every user (outcome `ok`, never deduped), written **before** the file leaves the server. If that write fails, the export is refused (fail closed). Refused attempts are audited too (outcome `refused`), deduped; see [Audit row](#audit-row). | `audit.ts` |
| 5 | **Formula-injection protection** (OWASP CSV injection), on every text cell, headers included. A cell gets a leading `'` when it starts with `=` `+` `-` `@`, tab, CR or LF (or their full-width forms), when it starts with one after leading spaces, or when any line of a multi-line value does. Number cells hold only finite numbers, which can't carry a formula, so they are written as plain numbers. | `sanitize.ts`, `csv.ts` |
| 6 | **Nothing is persisted.** The CSV is built in memory and streamed as the response, with `Cache-Control: no-store`. No Cloud Storage, no temp files. | `response.ts` |
| 7 | **One shared module.** A page supplies its params, its access rule, its loader and its columns, nothing else. | `types.ts`, `registry.ts` |
| 8 | **Normalized values and a row cap.** Rich text becomes plain text, user ids become display names, dates and times use one format. A **row cap** of 5,000 refuses a larger view with "narrow the filters". It never truncates, because a partial file handed to an auditor is worse than none. Loaders stop early: a query that is the view reads at most 5,001 docs (`readCapped`), and an in-memory-filtered view is checked (`checkRowCap`) before any per-row sub-read. The core re-checks after `load`, before resolving names. | `normalize.ts`, `cap.ts` |

### The request

`POST /api/export/{id}?<page params>`. It is a POST so that a cross-site link
or a prefetch can't start an export (and its audit row) in someone's
browser; a cross-site `Origin` is refused too (403, before the session is
read). The answer is either the file, or JSON `{ error }` with the
refusal's status.

The file:

- `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="<name>.csv"`, streamed.
- RFC 4180: comma separator, CRLF line endings, a field quoted when it
  contains a comma, a double quote, CR or LF, with quotes doubled.
- UTF-8 with a leading byte-order mark, so Excel reads accented names
  correctly.
- The first line is the column headers; one line per row after it.

### Value formats

Every time is **Mountain time** (`APP_TIME_ZONE` = America/Denver, from
`lib/time-zone.ts`), the bank's clock. No cell names the zone.

| Kind | Output |
|------|--------|
| `text` | trimmed string |
| `richtext` | `lib/rich-text.ts` `richTextToPlain`: bold dropped, links as `label (url)`, bullets as `• ` |
| `date` | `YYYY-MM-DD`, as text. A stored calendar day passes through; an instant becomes its Mountain day. |
| `datetime` | `YYYY-MM-DD HH:mm` Mountain time, as text. |
| `boolean` | `Yes` / `No` |
| `user` | display name. `Unassigned` for none, `—` for an id with no profile (same as the UI) |
| `number` | a finite number; anything else is blank |

Excel recognizes both date formats as dates when it opens the file, and they
sort correctly as text either way.

### Audit row

```
entity_type    "data_export"
action         "data_export"
entity_id      export id, e.g. "todos" (as requested, truncated, on refusals)
actor_uid      who exported, or tried to; null with no session
actor_source   "app"
team_id        team of the view, or null
outcome        "ok" | "refused"
reason         null when ok; otherwise one of the reasons below
http_status    200, or the refusal's status
export         { page, format: "csv", filters: {Label: value},
                 row_count (null when never counted), app_version,
                 query (refusals only: the requested query string, truncated),
                 file_name (ok rows) }
dedupe_window  refused rows only: start of the 10-minute window (ISO, UTC)
timestamp      server time
```

| `reason` | Status | When |
|----------|--------|------|
| `not_signed_in` | 401 | no valid session |
| `account_inactive` | 403 | the account no longer exists or is disabled |
| `unknown_export` | 404 | no page with that export id |
| `bad_params` | 400 | the definition rejected the parameters |
| `no_page_access` | 404 | the viewer can't open the page (To-Dos: not on the team and not an admin, or no such team), the same 404 the page gives |
| `not_found` | 404 | the loader found nothing to show (e.g. the team vanished between the checks) |
| `over_cap` | 413 | more than 5,000 rows |

`ok` rows fail closed (no row, no file) and are never deduped: every file
gets its own row.

`refused` rows are best effort (the request is refused either way, so a
failed write is logged, not surfaced) and **deduped**: at most one row per
(uid, or `anonymous` with no session; export id; reason) per 10-minute
window. The row's doc id is derived from a SHA-256 of that key plus the
window start, and it is written with `create()`, so a second identical
refusal in the window fails `ALREADY_EXISTS` and writes nothing. No read,
no client-writable state. An export id that isn't a real export counts as
one key (`(unknown)`), so made-up ids can't mint unlimited rows; the row
still records the id as requested (truncated). A different reason, a
different person or the next window gets its own row.

A cross-site POST is refused by the route's `Origin` check before the
session is read, so it isn't audited (it arrives without the `SameSite=Lax`
cookie anyway).

The row is written the same way as `lib/access-audit.ts` rows: an Admin SDK
write straight into `audit_log`. The generic audit trigger skips that
collection. No rules change was needed: `audit_log` stays `allow write: if false`.

## Adding a page

You add configuration only. The core, the route and the writer do not change.

1. **Write a definition**: `lib/export/pages/{page}.ts`, exporting an
   `ExportDefinition<Row, Params>` (see `lib/export/types.ts`;
   `lib/export/pages/todos.ts` is the model).
   - `id`: the URL id, which is also the audit `entity_id`. `title`: the
     page's name.
   - `parseParams(searchParams)`: read the **same query parameter names the
     page's server component reads**, plus `team` for team pages (the path
     segment). Validate ids. Return `{ ok: false, status: 400, ... }` for junk.
   - `authorize({ db, uid, viewer }, params)`: the **page's own access
     rule**, using the helper the page relies on, never a parallel one (team
     pages: `checkTeamAccess` from `lib/firebase/team-access.ts`). Return
     `null` to allow, or the same 404 the page gives. It runs before `load`.
   - `load({ db, uid, viewer }, params)`: run the **page's own queries** and
     apply the **page's own visibility predicate**, then
     `accessFor(type).canSee`, for this viewer. No admin-only shortcut and
     no admin-only column the page doesn't show this viewer. Return the rows
     in the order the page renders them. Honor the row cap early with
     `lib/export/cap.ts`: when a query is exactly the view, read it with
     `readCapped(query)` (at most 5,001 docs; refuse on the extra one). When
     the page filters a query's docs in memory (as To-Dos does), a limit
     would refuse views that fit, so call `checkRowCap(rows.length)` on the
     filtered rows instead, and do it **before** any per-row sub-read
     (milestones per rock, comments per item). Return `filters` (one
     `{label, value}` per filter shown on the page, using names, not ids),
     `teamId`, `fileNameParts`, and `names` (the roster map, so `user`
     columns don't re-read `/users`).
   - `columns`: `{ key, header, kind, value(row) }`. Choose a `kind`; don't
     format values yourself. Align `key`s with stored field names and
     `lib/item-registry.ts` vocabulary (owner, assigner, …).
   - If the page's ordering or filtering lives in a client component, move
     that pure function into `lib/` and import it from both, so the board and
     the export can't drift. To-Dos did this with `lib/todo-board-order.ts`.
2. **Register it** in `lib/export/registry.ts`.
3. **Add the control**: render
   `<ExportControl exportId="{id}" params={...} />` (from
   `components/export/export-control.tsx`) on the page, **for everyone**.
   Pass the page's current URL state with the same keys `parseParams`
   reads. Put a small `xxxExportParams(view)` helper in `lib/export/urls.ts`
   and test that it round-trips through `parseParams`. Team entity pages put
   the control in `EntityPageHeader`'s `leading` slot.
4. **Tests**:
   - in `lib/export/pages/{page}.test.ts`: a column snapshot (`[key, header,
     kind]` for every column), each filter, the ordering, and the params
     round-trip;
   - through the core (`lib/export/run.test.ts` is the model): a member's
     file holds exactly the rows that member's page shows, with hidden items
     seeded (someone else's private item, another team's item, any
     admin-only data) and absent; an admin's file still holds admin-visible
     data; someone without page access is refused before any load.

   The account check, injection, CSV and audit tests live in
   `lib/export/run.test.ts`, `csv.test.ts` and `sanitize.test.ts` and cover
   every page through the core.

## Not in the To-Dos export (by design)

The To-Dos file is the team's **To-Dos list**, as the tabs count it. It
leaves out two per-viewer reminder boxes on that page:

- "Your milestones": rock milestones. These belong to the Rocks export.
- "Assigned to me from other teams": these belong to the other teams' exports.
