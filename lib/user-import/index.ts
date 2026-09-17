// People-seed importer — used by the admin Import page and `pnpm users:seed`.
//
// Takes a CSV/TSV/XLSX of First, Last, Email, Team, Role and creates the
// people, the teams they name, and the memberships between them. Additive
// only; see run.ts for exactly what it will and won't touch.
//
// Split across siblings: normalize.ts (file → rows, column spellings, name
// splitting), plan.ts (rows → one entry per person and per team), run.ts (the
// Firestore/Auth apply). This file re-exports the public surface so
// `@/lib/user-import` resolves for every caller.

export type {
  SeedIssue,
  SeedPersonPlan,
  SeedPersonRow,
  SeedPlan,
  SeedPreviewRow,
  SeedReport,
  SeedTeamPlan,
} from "../user-import-types";

export { runUserImport } from "./run";
export type { SeedAuth, UserImportOptions } from "./run";

export {
  hasSeedColumns,
  nameFromEmail,
  readAccess,
  readSeedRows,
  splitFullName,
  SEED_COLUMNS,
} from "./normalize";

export { buildSeedPlan } from "./plan";
