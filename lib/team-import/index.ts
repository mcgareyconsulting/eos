// Shared team data importer — used by `pnpm import:csv` and the in-app
// Import page. Parses CSV/TSV/XLSX (ninety-style columns) and upserts
// scorecard / rocks / milestones / todos / issues / headlines into Firestore.
//
// IO-light: callers supply a Firestore handle and file buffers/tables.
// Re-import is idempotent via deterministic `imp-*` doc ids.
//
// Split across sibling modules in this directory: parse.ts (byte→table
// parsers), owners.ts (batched writer, preview collector, owner
// resolution), normalize.ts (per-row field normalizers), one file per kind
// importer (scorecard/rocks/milestones/todos/issues/headlines.ts), and
// run.ts (the runTeamImport orchestrator). This file re-exports the public
// surface so `@/lib/team-import` keeps resolving for existing callers.

export type {
  BulkGridTable,
  BulkNotice,
  ImportKind,
  ImportReport,
  KindStats,
  PreviewRow,
} from "../team-import-types";

export type { TeamImportOptions, TeamImportInputs } from "./run";
export { runTeamImport } from "./run";

export {
  assembleBulkInputs,
  classifyTable,
  expandUploads,
  GRID_ROW_CAP,
  isArchiveTable,
  readBulkTables,
  rowKey,
  teamFilterFor,
  toGridTables,
} from "./bulk";
export type { SourceTable, UploadFile } from "./bulk";

export { finishImportRun, sha256, startImportRun } from "./import-run";
export type { ImportRunStart } from "./import-run";

export {
  headlineTablesFromBytes,
  issueTablesFromBytes,
  pickRockWorkbookSheets,
  preferRegexForKind,
  rocksWorkbookFromBytes,
  tableFromBytes,
} from "./parse";

export {
  loadMembers,
  OwnerResolver,
  PreviewCollector,
  withUnmatchedOwnerNote,
  Writer,
} from "./owners";
export type { Member } from "./owners";

export {
  normalizeHeadlineKind,
  overLengthReason,
  rejectOverLength,
} from "./normalize";
