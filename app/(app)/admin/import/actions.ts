"use server";

import { revalidatePath } from "next/cache";
import { getAdminAuth } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/teams";
import { parseAllowlist } from "@/lib/auth-allowlist";
import { tableFromBytes } from "@/lib/team-import";
import { runUserImport } from "@/lib/user-import";
import type { SeedImportResult } from "./import-types";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB, matching the team import

// Which sheet of a workbook holds the roster. Only consulted for .xlsx; a
// CSV/TSV is one table and the regex never applies.
const PEOPLE_SHEET = /people|user|member|roster|directory|staff|employee|team/i;

function validateFilename(name: string) {
  if (!/\.(csv|tsv|xlsx)$/i.test(name)) {
    throw new Error("Upload a .csv, .tsv, or .xlsx file.");
  }
}

/**
 * Preview (dry-run) or apply a people seed: First, Last, Email, Team, Role.
 *
 * Org-admin only — it creates Auth accounts and teams across the whole org,
 * which is a wider blast radius than the per-team data import (leader-gated).
 *
 * Form fields:
 *   - file:   File (.csv / .tsv / .xlsx)
 *   - dryRun: "1" (default) | "0"
 */
export async function importSeedFile(
  formData: FormData,
): Promise<SeedImportResult> {
  // Outside try so Next's notFound() from requireAdmin isn't swallowed.
  const { db } = await requireAdmin();

  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Drop or choose a .csv / .xlsx file." };
    }
    validateFilename(file.name);
    if (file.size > MAX_BYTES) {
      return {
        ok: false,
        error: `File is too large (${Math.round(file.size / 1024 / 1024)} MB). Max is ${MAX_BYTES / 1024 / 1024} MB.`,
      };
    }

    const dryRun = formData.get("dryRun") !== "0";
    const buf = Buffer.from(await file.arrayBuffer());
    const table = tableFromBytes(buf, file.name, PEOPLE_SHEET);

    if (table.rows.length === 0) {
      return {
        ok: false,
        error:
          "No data rows found. Check that the first row is headers and there is at least one person below it.",
      };
    }

    const report = await runUserImport(db, getAdminAuth(), table, {
      dryRun,
      // The same allowlist createSession() enforces: an address that can't
      // sign in shouldn't get an account here either.
      allowlist: parseAllowlist(process.env.SIGN_IN_ALLOWLIST),
    });

    if (!dryRun) {
      revalidatePath("/admin/people");
      revalidatePath("/admin/teams");
      revalidatePath("/admin/import");
      revalidatePath("/directory");
      revalidatePath("/home");
    }

    return {
      ok: true,
      report,
      preview: {
        filename: file.name,
        rowCount: table.rows.length,
        headers: table.headers.filter(Boolean),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }
}
