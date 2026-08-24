// Client-safe column docs for the in-app Import page.
// Keep in sync with docs/CSV_IMPORT.md and lib/team-import parsers.

export type WebImportKind =
  | "rocks"
  | "todos"
  | "issues"
  | "headlines"
  | "scorecard";

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
      "Status: On Track / Off Track / Complete / Cancelled. Level: Company / Department / Individual. Level=Department rocks land in the Department section (even with a personal owner). Team/Department column filters multi-department exports. A rock already on the team is matched by title and left as it is.",
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
  scorecard: {
    required: ["Title"],
    optional: [
      "Owner",
      "Group Name",
      "Description",
      "Goal",
      "Unit",
      "week columns (one per period, e.g. 08/17/2026)",
    ],
    notes:
      "Group Name (ninety's own column, also accepted as Group / Section) becomes the measurable's Category. Every date-like column is read as a period and imported as that week's value, so one file brings both the measurables and their history. Goal accepts a comparator (>= 5, <= 63). Heads up: imported measurables are all created as WEEKLY — non-weekly ones need their interval set on the Scorecard tab afterwards.",
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
