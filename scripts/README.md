# Operator scripts

Command-line tooling for setting up and repairing real data. Every script is
registered in `package.json`, so `pnpm run` lists them all.

All of them read Firestore/Auth credentials from `.env.local` unless a
`--project` / `--database` flag says otherwise — check which project you are
pointed at before running anything marked destructive, and prefer the dry run
first where one exists.

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
| `migrate-company-rocks.ts` | `pnpm rocks:migrate-company` | Folds legacy `rock_type: "company"` rocks onto the two-flag model (`rock_type: "department"` + `is_company_rock: true`). Idempotent; the app reads either shape. | Writes. Dry-run unless `--apply`. |
| `deploy.sh` | `pnpm ship` | Builds the image, pushes it to Artifact Registry, and rolls Cloud Run. Reads `.env.prod` by default. | **Deploys to production.** `-- --dry-run` prints the plan. |

`csv-templates/` holds blank CSVs with the exact headers `import-csv.ts`
expects — hand them to anyone who has no export to give you.

Each script's own header comment carries the full flag list and worked
examples; this table is only the map.
