// Client-safe column docs for the in-app Import page.
// Keep in sync with docs/CSV_IMPORT.md and lib/team-import parsers.

export type WebImportKind = "rocks" | "todos" | "issues" | "headlines";

export const EXPECTED_HEADERS: Record<
  WebImportKind,
  { required: string[]; optional: string[]; notes: string }
> = {
  rocks: {
    required: ["Owner", "Title"],
    optional: [
      "Description",
      "Due Date",
      "Status",
      "Level",
      "Team",
      "Department",
      "Completed On",
      "Link",
      "Created Date",
      "Quarter",
    ],
    notes:
      "Status: On Track / Off Track / Complete / Cancelled. Level: Company / Department / Individual. Level=Department rocks land in the Department section (even with a personal owner). Team/Department column filters multi-department exports. Re-import updates by title.",
  },
  todos: {
    required: ["Owner", "Title"],
    optional: [
      "Description",
      "Due Date",
      "Repeat",
      "Team",
      "Department",
      "Completed On",
      "Link",
      "Created Date",
      "Archived Date",
      "Visibility",
    ],
    notes:
      "Archived rows are skipped by default. Completed On marks done. Visibility starting with “priv” is private to the owner.",
  },
  issues: {
    required: ["Owner", "Title"],
    optional: [
      "Description",
      "Type",
      "Status",
      "Priority",
      "Completed On",
      "Link",
      "Created Date",
      "Archived Date",
    ],
    notes:
      "Type: short / long (or sheet name Short-Term / Long-Term for .xlsx). Status: open / solving / solved / dropped. Multi-sheet workbooks import all issue sheets.",
  },
  headlines: {
    required: ["Owner", "Title"],
    optional: [
      "Description",
      "Type",
      "Team",
      "Department",
      "Completed On",
      "Link",
      "Created Date",
      "Archived Date",
    ],
    notes:
      "Type: Cascading / Customer / Employee / General (or the sheet name for .xlsx — a Cascading Messages sheet lands as cascading). Unrecognized types fall back to Employee. Multi-sheet workbooks import every headline sheet.",
  },
};
