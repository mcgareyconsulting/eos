// Client-safe types for the seed Import UI (not a "use server" module).

import type { SeedReport } from "@/lib/user-import-types";

export type SeedImportResult =
  | {
      ok: true;
      report: SeedReport;
      preview: { filename: string; rowCount: number; headers: string[] };
    }
  | { ok: false; error: string };

/** Columns the seed file is read for, shown on the page as the contract. */
export const SEED_FILE_COLUMNS: { name: string; required: boolean; note: string }[] = [
  { name: "First", required: true, note: "Also reads Given Name, or a single Name / Full Name column." },
  { name: "Last", required: true, note: "Also reads Surname. “Doe, Jane” in one Name column works too." },
  { name: "Email", required: true, note: "The identity. Must pass the sign-in allowlist, and is what the Google account links to." },
  { name: "Team", required: false, note: "Also reads Department / Group. Separate several teams with a semicolon. A team that doesn’t exist yet is created." },
  { name: "Role", required: false, note: "Stored as a job title on the profile. It does NOT grant leadership or admin — everyone imports as a plain member." },
];
