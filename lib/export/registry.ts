// Every page that can be exported (docs/EXPORT.md). The key is the export id
// the Export control and both routes use: /api/export/{id}, /print/{id}.
// To add a page: write its definition under lib/export/pages/ and add it here.

import { todosExport } from "./pages/todos";
import type { ExportDefinition } from "./types";

export const EXPORT_DEFINITIONS: Readonly<Record<string, ExportDefinition<never, never>>> = {
  todos: todosExport as unknown as ExportDefinition<never, never>,
};
