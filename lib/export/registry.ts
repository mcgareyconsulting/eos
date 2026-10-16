// Every page that can be exported (docs/EXPORT.md). The key is the export id
// the Export control and both routes use: /api/export/{id}, /print/{id}.
// To add a page: write its definition under lib/export/pages/ and add it here.

import { directoryExport } from "./pages/directory";
import { headlinesExport } from "./pages/headlines";
import { issuesExport } from "./pages/issues";
import { meetingsExport } from "./pages/meetings";
import { rocksExport } from "./pages/rocks";
import { scorecardExport } from "./pages/scorecard";
import { todosExport } from "./pages/todos";
import type { ExportDefinition } from "./types";

type AnyDefinition = ExportDefinition<never, never>;

export const EXPORT_DEFINITIONS: Readonly<Record<string, AnyDefinition>> = {
  todos: todosExport as unknown as AnyDefinition,
  rocks: rocksExport as unknown as AnyDefinition,
  issues: issuesExport as unknown as AnyDefinition,
  headlines: headlinesExport as unknown as AnyDefinition,
  scorecard: scorecardExport as unknown as AnyDefinition,
  meetings: meetingsExport as unknown as AnyDefinition,
  directory: directoryExport as unknown as AnyDefinition,
};
