"use server";

import { revalidatePath } from "next/cache";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { normalizePersonKey } from "@/lib/csv-import";
import { EXPECTED_HEADERS, type WebImportKind } from "@/lib/import-headers";
import {
  issueTablesFromBytes,
  preferRegexForKind,
  rocksWorkbookFromBytes,
  runTeamImport,
  tableFromBytes,
  type TeamImportInputs,
} from "@/lib/team-import";
import type { ImportActionResult } from "./import-types";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_KINDS = ["rocks", "todos", "issues"] as const;

function isKind(v: string): v is WebImportKind {
  return (ALLOWED_KINDS as readonly string[]).includes(v);
}

function revalidateTeam(teamId: string) {
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/meetings`);
  revalidatePath(`/teams/${teamId}/import`);
  revalidatePath("/home");
}

async function fileToBuffer(file: File): Promise<Buffer> {
  if (file.size > MAX_BYTES) {
    throw new Error(
      `File is too large (${Math.round(file.size / 1024 / 1024)} MB). Max is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

function validateFilename(name: string) {
  if (!/\.(csv|tsv|xlsx)$/i.test(name)) {
    throw new Error("Upload a .csv, .tsv, or .xlsx file.");
  }
}

function buildInputs(
  kind: WebImportKind,
  buf: Buffer,
  filename: string,
): { inputs: TeamImportInputs; headers: string[]; rowCount: number; sheets: string[] } {
  if (kind === "issues") {
    const tables = issueTablesFromBytes(buf, filename);
    const headers = tables[0]?.headers ?? [];
    const rowCount = tables.reduce((n, t) => n + t.rows.length, 0);
    const sheets = tables.map((t) => t.sheetName).filter((s): s is string => !!s);
    return {
      inputs: { issues: { tables } },
      headers,
      rowCount,
      sheets,
    };
  }

  if (kind === "rocks") {
    // Ninety ships rocks + milestones as one workbook; take both (N6).
    const { rocks, milestones, sheets } = rocksWorkbookFromBytes(buf, filename);
    return {
      inputs: {
        rocks: { table: rocks },
        ...(milestones ? { milestones: { table: milestones } } : {}),
      },
      headers: rocks.headers,
      rowCount: rocks.rows.length + (milestones?.rows.length ?? 0),
      sheets,
    };
  }

  const table = tableFromBytes(buf, filename, preferRegexForKind(kind));

  return {
    inputs: { todos: { table } },
    headers: table.headers,
    rowCount: table.rows.length,
    sheets: [],
  };
}

/**
 * Preview (dry-run) or apply an import of Rocks, To-Dos, or Issues for a team.
 * Form fields:
 *   - kind: rocks | todos | issues
 *   - file: File
 *   - dryRun: "1" | "0"
 *   - createOwners: "1" | "0"
 *   - includeArchived: "1" | "0"
 *   - fallbackOwnerId: optional team member uid (empty = skip unmatched)
 *   - rockTeam: optional Department/Team-column filter (e.g. "Enterprise Systems & Data")
 *   - existingRocks: "update" | "skip" (rocks kind; skip leaves stored rocks alone)
 *   - ownerAlias: repeatable "CSV Name=memberUid" (or member display name)
 */
export async function importTeamFile(
  teamId: string,
  formData: FormData,
): Promise<ImportActionResult> {
  try {
    const { db } = await requireTeamAccess(teamId);
    const members = await getTeamMembers(teamId);

    const kindRaw = String(formData.get("kind") ?? "");
    if (!isKind(kindRaw)) {
      return { ok: false, error: "Choose Rocks, To-Dos, or Issues." };
    }
    const kind = kindRaw;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Drop or choose a .csv / .xlsx file." };
    }
    validateFilename(file.name);

    const dryRun = formData.get("dryRun") !== "0";
    const createOwners = formData.get("createOwners") === "1";
    const includeArchived = formData.get("includeArchived") === "1";
    const fallbackRaw = String(formData.get("fallbackOwnerId") ?? "").trim();
    const rockTeam = String(formData.get("rockTeam") ?? "").trim() || undefined;
    // Default "update" matches the CLI. "skip" is the re-drop case: pull the
    // milestones in without rewriting rocks the team has since edited.
    const existingRocks =
      formData.get("existingRocks") === "skip" ? "skip" : "update";

    let fallbackOwnerId: string | null = null;
    if (fallbackRaw) {
      if (!members.some((m) => m.user_id === fallbackRaw)) {
        return { ok: false, error: "Owner fallback is not a member of this team." };
      }
      fallbackOwnerId = fallbackRaw;
    }

    // Resolve aliases: each entry is "CSV Name=uid-or-display-name"
    const ownerAliases = new Map<string, string>();
    for (const raw of formData.getAll("ownerAlias")) {
      const s = String(raw).trim();
      if (!s) continue;
      const eq = s.indexOf("=");
      if (eq <= 0) {
        return {
          ok: false,
          error: `Owner alias must look like "CSV Name=member" (got "${s}").`,
        };
      }
      const csvName = s.slice(0, eq).trim();
      const target = s.slice(eq + 1).trim();
      if (!csvName || !target) {
        return {
          ok: false,
          error: `Owner alias must look like "CSV Name=member" (got "${s}").`,
        };
      }
      const targetKey = normalizePersonKey(target);
      const match = members.find(
        (m) =>
          m.user_id === target ||
          normalizePersonKey(m.full_name) === targetKey,
      );
      if (!match) {
        return {
          ok: false,
          error: `Owner alias target "${target}" is not a member of this team.`,
        };
      }
      ownerAliases.set(normalizePersonKey(csvName), match.user_id);
    }

    const buf = await fileToBuffer(file);
    const { inputs, headers, rowCount, sheets } = buildInputs(kind, buf, file.name);

    if (rowCount === 0) {
      return {
        ok: false,
        error:
          "No data rows found. Check that the first row is headers and there is at least one data row.",
      };
    }

    const headerKeys = headers.map((h) => h.trim().toLowerCase());
    const hasTitle = headerKeys.some((h) =>
      [
        "title",
        "name",
        kind === "rocks" ? "rock" : kind === "todos" ? "to-do" : "issue",
        "todo",
        "task",
      ].includes(h),
    );
    if (!hasTitle) {
      const expected = EXPECTED_HEADERS[kind].required.join(", ");
      return {
        ok: false,
        error: `Could not find a Title/Name column. Expected headers include: ${expected}. Found: ${headers.filter(Boolean).join(", ") || "(none)"}`,
      };
    }

    const report = await runTeamImport(db, teamId, inputs, {
      dryRun,
      createOwners,
      fallbackOwnerId,
      includeArchived,
      rockTeam,
      existingRocks,
      ownerAliases: ownerAliases.size > 0 ? ownerAliases : undefined,
    });

    if (!dryRun) revalidateTeam(teamId);

    return {
      ok: true,
      report,
      preview: {
        filename: file.name,
        rowCount,
        headers: headers.filter(Boolean),
        sheets,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return { ok: false, error: message };
  }
}
