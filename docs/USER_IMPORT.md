# People seed — importing users, teams and memberships

Seeds **who is in the org**: the people, the teams they belong to, and the
memberships between them. This is the roster layer, upstream of
`docs/CSV_IMPORT.md`, which seeds a team's *data* (rocks, to-dos, issues,
scorecard) once the team and its members exist.

Shared engine: `lib/user-import/` — used by both entry points below, so the
app and the CLI produce identical documents.

---

## The file

One row per person-and-team. Columns are matched case- and
whitespace-insensitively.

| Column          | Required | Also reads                      | What it does |
|-----------------|----------|---------------------------------|--------------|
| **First Name**  | yes\*    | `First`, `Given Name`           | First name |
| **Last Name**   | yes\*    | `Last`, `Surname`               | Surname |
| **Email**       | **yes**  | `Email Address`, `E-mail`, `Work Email` | The identity. Everything keys off it |
| **Team**        | no       | `Department`, `Dept`, `Group`   | Team to join. Created if it doesn't exist |
| **Role access** | no       | `Access`, `Permission`, `Role`  | `Admin` → **org admin**. Anything else → **Member** |
| *(Job Title)*   | no       | `Position`, `Title`             | Display only. Grants nothing |

\* A single **`Name`** / **`Full Name`** column works instead of First + Last.
Both `Jane Doe` and `Doe, Jane` parse. If a row has an email and no name at
all, the name is derived from the address (`jane.doe@` → Jane Doe).

```csv
First Name,Last Name,Team,Role access,Email
Jane,Doe,Leadership,Admin,jane.doe@highplainsbank.com
Ann,Roe,Leadership,Member,ann.roe@highplainsbank.com
Bob,Loe,Lending,,bob.loe@highplainsbank.com
```

Tab-separated pastes out of Sheets or Excel work as-is — the delimiter is
sniffed from the header row — as does `.xlsx`.

**Someone on two teams** gets either two rows with the same email, or one row
whose Team cell lists both separated by a **semicolon**:

```csv
Jane,Doe,"Leadership; Lending",Admin,jane.doe@highplainsbank.com
```

Semicolon — **not comma**. A comma inside a quoted cell is as likely to be
part of one team's name (`"Lending, Retail & Ops"`) as a separator, and
guessing wrong invents teams nobody asked for.

---

## What it does, and what it deliberately doesn't

**Creates:**

- an **Identity Platform account** per email that doesn't have one. Nobody is
  emailed and no password is set — it's an empty record that activates on the
  person's first Google sign-in, exactly like `pnpm accounts:create`.
- a **`/users/{uid}` profile** with the name, email and job title.
- a **team** for any Team value the org doesn't have yet (matched on name,
  ignoring case and punctuation).
- a **`team_members` row** joining each person to each of their teams, always
  with role `member`.
- the **org-admin custom claim** for every row whose `Role access` says
  `Admin`, merged onto any claims the account already carries.

**Never:**

- **removes anyone.** People and memberships the file no longer mentions are
  listed in the report under *"On a team here, but not in the file"* for you
  to action by hand. The import doesn't act on it.
- **changes an existing membership's role.** Re-running last quarter's file
  cannot demote a leader you promoted since.
- **revokes org admin.** Someone holding the claim whom the file calls a
  member keeps it, and is listed in the report. Revoking is deliberate:
  `pnpm admin:set-role --email <address> --role normal --apply`.
- **grants team leadership.** See below.

**Idempotent.** People match on email, teams on name, membership ids are
deterministic (`{teamId}__{uid}`). Applying the same file twice is a no-op the
second time.

### What `Role access` does and doesn't grant

**`Admin` → org admin.** The Identity Platform custom claim `role: "admin"` —
god mode: every team's data, plus the `/admin` screens. Matched case- and
wording-insensitively (`Admin`, `admin`, `Org Admin`, `Administrator`).

**Everything else → Member**, blank included. `Member`, `User`, `Standard`,
`Normal`, `None` and `Staff` are understood as meaning exactly that. Any
*other* value — `Owner`, `Leader` — also imports as a member but is
**reported** as unrecognized, so a file that meant something by it doesn't
pass unnoticed.

Two consequences worth knowing before you run it:

1. **A granted claim needs a fresh sign-in.** The claim rides on the session
   cookie, so someone already signed in keeps their old access until they
   sign out and back in.
2. **`Role access` never sets team leadership**, so every team the import
   creates starts with no *leader*. Org admins can still manage it; nobody
   else can. The report lists these teams, and the Teams tab flags them
   *"no leader yet"*. Promote one on the Members tab, or with
   `pnpm member:set-role`.

### The allowlist applies

An address that `SIGN_IN_ALLOWLIST` would reject is **skipped and reported**,
not imported — an account that can't pass `createSession()` is worse than no
account, because it silently owns imported work nobody can sign in to claim.
Keep the env var in lockstep with `inDomain()` in `firestore.rules`
(see `docs/TEAM_MGMT_OPS.md` §1).

---

## In-app (org admin)

**Admin → Import seed file** (`/admin/import`). Org-admin only; every `/admin`
page 404s for everyone else.

Drop the file → **Preview** → read the report → **Apply**. Apply stays disabled
until a preview has run, because the report is the only place you see which
teams are about to be created.

The report gives counts, a row-by-row table of what lands where (including who
gets org admin), and review lists for everything that needs a human: rows that
couldn't be imported and why, org admin granted, people who kept org admin
though the file calls them members, unrecognized `Role access` values, teams
left without a leader, and people on a roster here but absent from the file.

The other two admin tabs cover the rest of the lifecycle:

- **People** — search everyone the app knows about, add a person, delete one.
- **Teams** — create a team, rename a team, see member/leader counts.

### Deleting a person

*Admin → People → Delete* removes **access**, not history:

- every roster row is deleted, and they're dropped from any speaking order or
  meeting-driver slot pointing at them;
- their Identity Platform account is deleted, so they can't sign in;
- their `/users` profile is **kept**, marked `deactivated_at`, so every rock,
  to-do, issue and headline they owned still renders their name instead of
  turning into an unattributed row.

Their owned work stays where it is. If someone needs to pick it up, reassign
first — `pnpm user:reassign` (see `docs/TEAM_MGMT_OPS.md` §2b).

You cannot delete your own account.

---

## CLI

```bash
# always look first — writes nothing
pnpm users:seed ./people.csv --database hpb-eos-sandbox-db

# then apply
pnpm users:seed ./people.csv --database hpb-eos-sandbox-db --apply
```

| Flag | Effect |
|------|--------|
| `--apply` | Actually write. Without it, dry run |
| `--database <id>` | Target database, e.g. `hpb-eos-sandbox-db` |
| `--project <id>` | Firebase project, overriding `.env.local` |
| `--no-allowlist` | Skip the allowlist check. **Sandbox only** — it creates accounts that cannot sign in |

Credentials work the same way as every other script here (ADC, or
`FIREBASE_SERVICE_ACCOUNT_JSON`). If you hit `rapt_required`, see
`docs/TEAM_MGMT_OPS.md` §0.

---

## Order of operations at cutover

1. `pnpm users:seed people.csv --apply` — people, teams, memberships, admins.
2. Promote a leader on each team (`pnpm member:set-role`, or the Members tab).
   Have anyone granted org admin sign out and back in.
3. Per-team data import (`docs/CSV_IMPORT.md`) — rocks, to-dos, issues,
   scorecard. Owner names in those files now match real accounts, so rows land
   on real people instead of `import-*` placeholders.

Doing it in this order is the point: the placeholder problem
`scripts/create-accounts.ts` exists to work around only happens when the data
import runs before the people exist.
