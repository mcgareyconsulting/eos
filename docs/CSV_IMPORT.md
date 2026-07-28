# CSV import — seeding real client data

`pnpm import:csv` loads a team's **scorecard**, **rocks**, and **milestones**
from CSV, TSV, or **.xlsx**. It targets the column sets ninety.io exports (the
tool clients are migrating off of), but nothing is ninety-specific — any
spreadsheet with the same headers works, including one pasted out of Excel or
Sheets as TSV.

Use it to replace demo data with a client's actual numbers before a
walkthrough, or to migrate a team for real at cutover.

```bash
# always look first — writes nothing
pnpm import:csv --team "Leadership Team" \
  --scorecard ~/Downloads/scorecard.csv \
  --rocks ~/Downloads/rocks.csv \
  --milestones ~/Downloads/milestones.csv \
  --dry-run

# then drop --dry-run to apply
```

Templates with the exact expected headers live in
[`scripts/csv-templates/`](../scripts/csv-templates) — hand those to a client
who doesn't have an export, or use them to sanity-check the importer.

> **Which project am I writing to?** The script reads `.env.local`, exactly like
> `pnpm seed` — so if that file points at `hpb-eos-prod`, an unqualified import
> goes to **production**. Pass `--project` (and `--database`) to target
> something else without editing `.env.local`; the run prints the project and
> database it resolved before it touches anything. Always `--dry-run` first.
>
> The trial project uses the **default** database, while `.env.local` names the
> prod one, so it needs both flags:
>
> ```bash
> GOOGLE_APPLICATION_CREDENTIALS=.firebase/eos-admin-key.json \
> pnpm import:csv --project hpb-eos --database "" …
> ```

## Standing up a whole team from an export

One command creates the team, puts you on it as leader, creates a member for
every distinct `Owner` in the files, and loads the data:

```bash
pnpm import:csv \
  --team "Enterprise Systems & Data" --create-team \
  --leader you@example.com \
  --rocks rocks.csv --milestones milestones.csv --scorecard scorecard.csv \
  --dry-run
```

- `--create-team` is required the first time; leave it off afterward so a typo
  can't create a second team with a slightly different name.
- `--leader` takes the address you sign in to the app with. **That account has
  to have signed in once** so Firebase Auth knows it — otherwise the run stops
  and tells you. (On the emulator it's created for you.) If the leader hasn't
  signed in yet, use `--leader-name "Their Name"` instead: it promotes the member
  created from their `Owner` rows, and they become a real leader once they log in
  and you reassign.
- `--member you@example.com` adds someone who owns nothing in the export — and,
  for anyone who *does* own rows and already has a login, it's what makes their
  rows land on that login instead of a placeholder (name matching picks them up
  once they're a member).
- Everyone else comes from the `Owner` columns, as placeholder members (see
  [Owners](#owners)). Rocks and milestones alone are enough to populate a
  roster — the scorecard is optional.
- If the export spells your name differently than your Google account does, map
  it: `--owner-alias "Dan McGarey=you@example.com"`. Otherwise your rows land on
  a placeholder member instead of your login.

### Worked example — what actually ran

The "Enterprise Systems & Data" team on the **trial** project (`hpb-eos`), from
ninety exports taken 2026-07-27:

```bash
GOOGLE_APPLICATION_CREDENTIALS=.firebase/eos-admin-key.json \
pnpm import:csv \
  --project hpb-eos --database "" \
  --team "Enterprise Systems & Data" --create-team \
  --leader-name "Steph Benes" \
  --member mcgareyconsulting@gmail.com \
  --member joe.creighton@highplainsbank.com \
  --rocks      ~/Downloads/Rocks_Milestones_Enterprise_Systems___Data_07272026.xlsx \
  --milestones ~/Downloads/Rocks_Milestones_Enterprise_Systems___Data_07272026.xlsx \
  --scorecard  ~/Downloads/scorecard-export.csv \
  --as-of 2026-07-27 --dry-run
```

Result: 8 rocks, 20 milestones, 3 metrics (17 weekly values), 5 members —
Steph Benes as leader plus two placeholders, and two real logins. Joe Creighton
is listed with `--member` *because* he owns rows and already has an account: that
makes his eight rows resolve to his real login instead of a placeholder.

> **Sign-in domain:** `firestore.rules` gates the broad user/team reads to
> `@highplainsbank.com` accounts. Page loads go through the admin SDK and are
> unaffected, but the **live L10 meeting screens read from the client SDK** — so
> a non-HPB login (a personal Gmail, say) will see those subscriptions denied on
> any project deployed with those rules. Fine on the emulator and on the trial
> project; something to know before demoing a live meeting from a Gmail account.

## Options

| Flag | Meaning |
| --- | --- |
| `--team <name\|id>` | **Required.** Target team, matched by doc id first, then by exact name. Run `pnpm team:info` to list them. |
| `--create-team` | Create the team when the name doesn't exist. Opt-in, so a typo'd `--team` fails loudly instead of standing up a near-duplicate. |
| `--project <id>` | Firestore project to write to, overriding `.env.local`. |
| `--database <id>` | Firestore database id. Pass `--database ""` for the default database (prod uses a *named* one). |
| `--leader <email\|uid>` | Add this account to the team as **leader** — pass the email you sign in to the app with. Resolved through Firebase Auth, so the membership lands on the uid you actually log in as. |
| `--leader-name <name>` | Make the member behind this `Owner` name the leader. Use when the leader hasn't signed in yet, so has no account to point `--leader` at. |
| `--member <email\|uid>` | Add this account as a member. Repeatable — use it for yourself, and for anyone with an existing login whose rows should land on it. |
| `--rocks-sheet <name>` | Sheet to read from an `.xlsx` (likewise `--milestones-sheet`, `--scorecard-sheet`). Defaults to the sheet whose name matches, else the first. |
| `--owner-alias "CSV Name=email\|uid"` | Pin one CSV owner name to a specific account. Repeatable. |
| `--scorecard <file>` | Scorecard export (wide — one column per week). |
| `--rocks <file>` | Rocks export. |
| `--milestones <file>` | Milestones export, linked to rocks by `Rock Name`. |
| `--dry-run` | Parse, resolve owners, report what would happen. Writes nothing. |
| `--as-of <YYYY-MM-DD>` | Anchor for undated week headers. Defaults to today — set it when importing an export that's more than a few months stale. |
| `--owner-fallback <email\|uid\|name>` | Park rows whose owner isn't on the team on this existing member. |
| `--no-create-owners` | Don't create placeholder members; skip rows with an unresolvable owner instead. |
| `--include-archived` | Also import rows the export marks archived — scorecard rows whose `Status` says archived/inactive, and to-dos/milestones carrying an `Archived Date` (all skipped by default). |
| `--completed-since <YYYY-MM-DD>` | Back-import cutoff: drop to-dos/milestones completed before this date. Open rows always import. |
| `--rock-team <value>` | With a multi-team export, import only rows whose `Team` column matches. |

## Excel workbooks

Ninety exports Rocks and Milestones as a **single two-sheet .xlsx**, not as CSV,
so point both flags at the same file — each picks its own sheet by name:

```bash
pnpm import:csv --team "…" \
  --rocks      ~/Downloads/Rocks_Milestones_….xlsx \
  --milestones ~/Downloads/Rocks_Milestones_….xlsx
```

The reader is built in (`lib/xlsx.ts`, no dependency) and covers what these
exports contain: shared strings, inline strings, and **date cells**, which Excel
stores as day-count serials — `46220` is 2026-07-17, not the number 46220. It
does **not** evaluate formulas (cached values are used), expand merged cells, or
read zip64 archives; for anything hand-built and elaborate, save as CSV first.

Sheet choice is reported in the run output, along with every sheet in the file,
so a wrong pick is visible immediately. Override with `--rocks-sheet` etc.

## Expected columns

Headers are matched case- and whitespace-insensitively, and a few synonyms are
accepted (`Title`/`Name`/`Metric`, `Owner`/`Accountable`, …). Extra columns are
ignored, so an export with more columns than listed here imports fine.

### Scorecard (wide format)

```
Group Name, Status, Title, Description, Owner, Goal, Average,
Jul 27 - Aug 2, Jul 20 - Jul 26, … (one column per week)
```

- **Title** → metric name (required — rows without one are skipped).
- **Group Name** → the section header the scorecard groups rows under.
- **Goal** sets both the target and the comparison: `≥ 40`, `>= 40`,
  `Greater Than or Equal To 40`, `≤ 5`, `at most 5`, `= 12`, `$1,200,000`,
  `95%`. A bare number means *at least* — the EOS default.
- **Unit** is inferred from the goal's formatting (`$` → currency, `%` →
  percent, `1:30` → time, `Yes` → yes/no), falling back to the week values when
  the goal column is blank.
- **Average** is ignored — the app computes it from the weeks it has.
- **Status** containing `archived` / `inactive` / `paused` skips the row unless
  `--include-archived`.
- **Week columns** are recognized as `Jul 27 - Aug 2`, `Jul 27 - Aug 2, 2026`,
  `7/27 - 8/2`, `7/27/2026`, or `2026-07-27`, and each one is bucketed to the
  Monday of that week (what the app keys entries on). Headers with no year
  resolve to whichever year lands closest to `--as-of`.
- **Cell values** handle `$1,234`, `12.5%`, `(400)` → -400, `Yes`/`No` → 1/0,
  and `1:30` → 90 minutes. Blank, `-`, `—`, `N/A` leave the week empty rather
  than writing a zero.

The app shows the **last 13 weeks**, so older columns import but won't be
visible until time passes.

> **Heads-up on large scorecards:** the scorecard page currently loads weekly
> values with a single `where("metric_id", "in", …)` query capped at 30 metrics
> (`app/(app)/teams/[teamId]/scorecard/page.tsx`). Import more than 30 metrics
> for one team and the extras render with empty weeks even though the entries
> are in Firestore. Chunk that query before importing a scorecard that big.

### Rocks

```
Owner, Title, Description, Due Date, Status, Level, Team,
Attachment Names, Completed On, Link, Created Date, Quarter
```

- **Status** maps onto the app's four: `On Track` → on track; `Off Track` /
  `At Risk` / `Behind` → off track; `Complete` / `Done` → done; `Cancelled` /
  `Archived` → cancelled. **A row with a `Completed On` date is imported as done
  regardless of its status column** — exports routinely leave finished rocks
  marked "On Track."
- **Level** → rock type (`Company` / `Department` / `Individual`).
- **Quarter** accepts `Q3 2026`, `2026-Q3`, `2026 Q3` and normalizes to the
  app's `YYYY-Qn`; if blank it's derived from the due date, and failing that from
  today. A **fiscal** label (`Q2 FY 2026` — what HPB's export uses) is kept
  word-for-word: fiscal quarters don't line up with calendar ones, and the app
  only renders this string as a label, so relabelling would misstate it.
- **Due Date** blank → end of the current quarter.
- **Link** is kept on the doc as `source_link` so the reference back to the old
  tool survives, though nothing renders it yet.
- **Attachment Names** is **not** imported — there's no attachments feature yet
  (it's on the roadmap and needs a Cloud Storage bucket). The run reports how
  many rows had attachments so you know what was left behind.
- **Team** is only used by `--rock-team`. Without that flag every row lands on
  `--team`, and a multi-team file gets a warning.

### Milestones

```
Owner, Title, Description, Rock Name, Due Date, Completed On, Link
```

Milestones are stored as to-dos linked to their rock (`source_rock_id`), which
is how the app models them — so they show up under the rock **and** in the
owner's to-do list.

**`Rock Name` must match a rock's title** (ignoring case and punctuation),
either from the rocks file in the same run or a rock already on the team. Rows
that don't match are skipped and listed at the end of the run. Import rocks and
milestones together and this takes care of itself.

Milestones honor `Archived Date` and `Created Date` the same way to-dos do —
see below.

### To-Dos

```
Owner, Title, Description, Due Date, Repeat, Team, Attachment Names,
Completed On, Link, Created Date, Archived Date
```

Standalone to-dos — same `todos` collection as milestones, but with no
`source_rock_id`, so they show only in the owner's list and the L10 To-Dos
segment.

- **Completed On** sets `completed_at`, which is what splits the app's *Open*
  and *Done* lists. Blank = open.
- **Archived Date** — any value means the row is **skipped**. Archived to-dos
  carry no completion date, so importing them would park them in the *open*
  list permanently and bury the live items. Pass `--include-archived` to bring
  them in anyway. The run reports how many were held back.
- **Created Date** is used for `created_at` when the doc is new, so age and
  creation ordering survive the import instead of everything looking like it
  was created at import time. Blank falls back to the server clock.
- **`--completed-since <YYYY-MM-DD>`** is the back-import cutoff: rows completed
  before that date are dropped. Open rows always import, however old — an old
  open to-do is still live work. Both the To-Dos page and the live L10 To-Dos
  segment render the *Done* list unbounded and oldest-first, so a multi-year
  export without a cutoff pushes the real work below a wall of closed items.
  For a live meeting, a cutoff at the start of the current quarter is usually
  right.
- **Due Date** blank → end of the current quarter.
- **Repeat** is **not** imported — there's no recurrence in the data model, so
  a repeating to-do lands as a single item on its next due date. The run lists
  every recurring row by name and cadence so you can re-create the schedule by
  hand rather than discovering the gap later.
- **Visibility** — a `Visibility`/`Private` column starting with "priv" makes
  the to-do private to its owner; anything else (including a missing column) is
  team-visible, which is what puts it in the L10 segment.
- **Attachment Names** is not imported (no attachments feature yet).
- **Team** is ignored here — every row lands on `--team`. (`--rock-team` filters
  rocks and milestones only.)

## Owners

The `Owner` column is a name; the app stores a user id. Owners are matched
against team members by display name, `First Last`, email, and email local part
(`sarah.chen@…` matches "Sarah Chen"), plus an unambiguous first- or last-name
match.

Anyone who doesn't match gets a **placeholder member** — a `users` doc + team
membership with an `import-…` id — so the data renders with the right names
before those people have ever signed in. They're listed at the end of the run
and show up in `pnpm team:info`.

When the real person signs in with Google they get a *different* uid, so
reassign their rows once accounts exist — re-import with
`--owner-alias "Their Name=their@email.com"` and delete the placeholder. Use
`--no-create-owners` on a client's production project if you'd rather not create
anything, or `--owner-fallback` to park unmatched rows on one existing member.

Aliases take priority over name matching, so `--owner-alias` is also the fix for
two people who share a first name, or an export that uses nicknames.

## Re-running

Every imported doc gets a deterministic id derived from the team and the row's
natural key (metric name, rock title, rock + milestone title). **Re-importing a
corrected file updates those rows in place instead of duplicating them**, and
their original `created_at` is preserved. Rows created in the app by hand are
untouched — they have random ids and no `import_source` field.

Two consequences worth knowing:

- **Renaming a row in the CSV creates a new one** (the natural key changed).
  Delete the stale one in the app.
- **Deleting a row from the CSV doesn't delete it from the app.** The importer
  only ever adds and updates. Same for a week cell that went from a number to
  blank — the previously imported value stays; clear it in the app.

Everything it writes carries `import_source: "csv"`, so a bad import is easy to
find and clear out from the Firestore console.
