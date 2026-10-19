# Operator scripts

Command-line tooling for setting up and repairing real data. Every script is
registered in `package.json`, so `pnpm run` lists them all.

Pick the database with `--target`, which every TypeScript script accepts:

```sh
pnpm team:info --target sandbox    # hpb-eos-prod / hpb-eos-sandbox-db, from .env.local
pnpm team:info --target prod       # hpb-eos-prod / hpb-eos-prod-db, gcloud ADC
```

- `--target sandbox` loads `.env.local` and pins the sandbox database.
- `--target prod` uses Application Default Credentials
  (`gcloud auth application-default login`). It ignores every Firebase
  project/database/emulator/credential value in `.env.local` (other settings,
  such as `SIGN_IN_ALLOWLIST`, still come from it) and drops
  `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Each run prints a one-line banner to stderr first, e.g.
  `Target: PROD (hpb-eos-prod / hpb-eos-prod-db), credentials: Application Default Credentials`.
  Read it before adding `--apply` / `--yes`.
- `--target` cannot be combined with `--project`, `--database` or
  `--env-file`; an unknown target exits with an error.
- Without `--target`, a script behaves as it always has: `.env.local`, unless
  its own `--project` / `--database` flag says otherwise. Nothing defaults to
  prod. `backfill-issue-comment-counts.ts` has no default: it needs `--target`
  or `--env-file <path>`.

The flag is parsed (and removed from argv) by `scripts/lib/target.ts`, which
each script imports first via `./lib/load-target`. Do not reach prod through
`.env.prod` — that file is deprecated for operator scripts.

Check which database you are pointed at before running anything marked
destructive, and prefer the dry run first where one exists.

| Script | Alias | What it does | Safety |
| --- | --- | --- | --- |
| `create-accounts.ts` | `pnpm accounts:create` | Pre-creates Firebase Auth accounts so imported rows can be keyed to real uids before anyone signs in. Sends no email. | Writes (Auth only). Idempotent; `--dry-run` available. |
| `set-admin-role.ts` | `pnpm admin:set-role` | Grants or revokes the org-level `role: "admin"` custom claim. | Writes (Auth claims). Dry-run unless `--apply`. |
| `set-member-role.ts` | `pnpm member:set-role` | Promotes or demotes one team member between `leader` and `member`. | Writes. Dry-run unless `--apply`. |
| `team-info.ts` | `pnpm team:info` | Lists every team, its roster, and how much EOS data each holds. | Read-only. |
| `import-csv.ts` | `pnpm import:csv` | Imports scorecards, rocks, milestones, issues, to-dos and headlines from ninety.io-style CSV/TSV/XLSX exports. | Writes. Use `--dry-run` first. |
| `delete-team.ts` | `pnpm team:delete` | Deletes a team and everything scoped to it. Leaves `audit_log` and real user accounts alone. | **Destructive, irreversible.** Reports only unless `--yes`. |
| `copy-db.ts` | `pnpm db:copy` | Copies every document from one Firestore database to another in the same project (prod → sandbox refresh). Destination id must contain `sandbox`. | **Destructive to the destination.** `--dry-run` available. |
| `reassign-user.ts` | `pnpm user:reassign` | Moves all EOS data and memberships from one uid to another — e.g. someone switched Google accounts. | Writes. Dry-run unless `--apply`. |
| `merge-import-user.ts` | `pnpm user:merge` | Merges a CSV-import placeholder uid (`import-*`) into the person's real Auth uid on one team. | Writes. Dry-run unless `--apply`. |
| `backfill-team-ids.ts` | `pnpm users:backfill-team-ids` | Rebuilds `users/{uid}.team_ids` from `team_members` (the list the rules check with one `get()` + `hasAny()`). Safe to re-run. | Writes. Dry-run unless `--apply`; `--target` (or `--database <id>`). |
| `backfill-issue-comment-counts.ts` | `pnpm issues:backfill-comment-counts` | Recounts `issues/{id}.comment_count` (the row's comment badge) from `entity_comments`. Needed once for issues commented on before the counter shipped; safe to re-run. | Writes. Dry-run unless `--apply`; `--target` or `--env-file` required (no default target). |
| `import-feedback-seed.ts` | `pnpm feedback:import` | Creates the admin-only feedback tracker's items (`feedback_items/fb-NNN`, ROADMAP N73) from `docs/feedback/feedback-tracker-seed.json`, one "imported" activity row each. Create-if-absent: never overwrites an item already in the database, so it is safe to re-run. `--actor <uid>` attributes the writes to the operator. | Writes. Dry-run unless `--apply`; `--target` or `--env-file` required (no default target). |
| `deploy.sh` | `pnpm ship` | Builds the image, pushes it to Artifact Registry, and rolls Cloud Run. Reads `.env.prod` by default. | **Deploys to production.** `-- --dry-run` prints the plan. |
| `restore-test.sh` | `pnpm backup:restore-test` | Restores the newest (or a named) Firestore backup into a throwaway database, counts documents against the live database, reports PASS/FAIL, then deletes the throwaway database. The quarterly backup-restore drill in `docs/BACKUP_RUNBOOK.md`. Uses `restore-test-count.ts` internally. | Read-only against the source database. Writes/deletes only the throwaway `--target` database. Dry-run unless `-- --apply`. |

`csv-templates/` holds blank CSVs with the exact headers `import-csv.ts`
expects — hand them to anyone who has no export to give you.

Each script's own header comment carries the full flag list and worked
examples; this table is only the map.
