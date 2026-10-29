"use server";

import { revalidatePath } from "next/cache";
import { requireTeamLeader, getTeamMembers } from "@/lib/firebase/teams";
import { normalizePersonKey } from "@/lib/csv-import";
import {
  assembleBulkInputs,
  expandUploads,
  finishImportRun,
  readBulkTables,
  rowKey,
  runTeamImport,
  startImportRun,
  teamFilterFor,
  toGridTables,
  type ImportKind,
} from "@/lib/team-import";
import { SKIP_ROWS, type BulkImportResult } from "./import-types";

// Whole upload, not per file. Server Actions cap the request body at 1 MB
// (left at the Next default on purpose — raising it widens every action), so
// this stays under it with room for the multipart overhead. A team's whole
// ninety export zipped is ~70 KB.
const MAX_BYTES = 950 * 1024;
const MAX_EXCLUDED = 50_000;

function revalidateTeam(teamId: string) {
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/headlines`);
  revalidatePath(`/teams/${teamId}/scorecard`);
  revalidatePath(`/teams/${teamId}/meetings`);
  revalidatePath(`/teams/${teamId}/import`);
  revalidatePath("/home");
}

function parseJson(raw: FormDataEntryValue | null): unknown {
  if (raw === null || raw === "") return undefined;
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new Error(
      "Malformed import request — reload the page and try again.",
    );
  }
}

function parseExclude(raw: FormDataEntryValue | null): Set<string> {
  const arr = parseJson(raw);
  if (arr === undefined) return new Set();
  if (!Array.isArray(arr) || arr.length > MAX_EXCLUDED) {
    throw new Error(
      "Malformed import request — reload the page and try again.",
    );
  }
  return new Set(arr.filter((v): v is string => typeof v === "string"));
}

/**
 * Preview (dry-run) or apply a bulk import: a .zip of a team's ninety export
 * and/or loose .xlsx/.csv/.tsv files. Every sheet is classified by its
 * headers; all of them run through one runTeamImport, so milestones link to
 * rocks from the same drop.
 *
 * Form fields:
 *   - file: File (repeatable) — .zip / .xlsx / .csv / .tsv
 *   - dryRun: "1" | "0"
 *   - exclude: JSON string[] of `${tableId}#${row}` — rows the user unticked
 *   - createOwners: "1" | "0"   (admin only)
 *   - includeArchived: "1" | "0"
 *   - fallbackOwnerId: "" / absent = No Owner (owner_id null + the unmatched
 *     name in the description), SKIP_ROWS = drop the row, or a team member uid
 *   (The file's Team column is matched against this team — teamFilterFor.)
 *   - ownerAlias: repeatable "File Name=memberUid" (or member display name)
 */
export async function importTeamBundle(
  teamId: string,
  formData: FormData,
): Promise<BulkImportResult> {
  try {
    // Leader-or-admin, matching getImportableTeams: imports bulk-write team
    // data and (admin-only createOwners) roster rows.
    const {
      db,
      isAdmin,
      uid: actorUid,
      team,
    } = await requireTeamLeader(teamId);
    const members = await getTeamMembers(teamId);

    const uploads = formData
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (uploads.length === 0) {
      return {
        ok: false,
        error: "Drop a .zip of the export, or the .xlsx / .csv files.",
      };
    }
    const total = uploads.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) {
      return {
        ok: false,
        error: `Upload is ${Math.round(total / 1024)} KB. Max is ${MAX_BYTES / 1024} KB — zip the files, or import them in two goes.`,
      };
    }

    const dryRun = formData.get("dryRun") !== "0";
    // Placeholder people are an admin-only act (spec 2.1/2.4): a leader's
    // flag is ignored, never trusted.
    const createOwners = isAdmin && formData.get("createOwners") === "1";
    const includeArchived = formData.get("includeArchived") === "1";
    const fallbackRaw = String(formData.get("fallbackOwnerId") ?? "").trim();
    // Each tab is imported as what its columns say it is. There is no
    // client override: re-typing a tab (rocks read as to-dos) is a footgun
    // with no use now that detection matches every ninety export.
    const kinds = new Map<string, ImportKind | null>();
    const exclude = parseExclude(formData.get("exclude"));

    // Unmatched owners import as No Owner by default — losing rows silently is
    // worse than importing them unassigned. SKIP_ROWS opts back out; picking a
    // member parks them on that member instead.
    const unmatchedOwner = fallbackRaw === SKIP_ROWS ? "skip" : "no-owner";

    let fallbackOwnerId: string | null = null;
    if (fallbackRaw && fallbackRaw !== SKIP_ROWS) {
      if (!members.some((m) => m.user_id === fallbackRaw)) {
        return {
          ok: false,
          error: "Owner fallback is not a member of this team.",
        };
      }
      fallbackOwnerId = fallbackRaw;
    }

    // Resolve aliases: each entry is "File Name=uid-or-display-name"
    const ownerAliases = new Map<string, string>();
    for (const raw of formData.getAll("ownerAlias")) {
      const s = String(raw).trim();
      if (!s) continue;
      const eq = s.indexOf("=");
      const csvName = eq > 0 ? s.slice(0, eq).trim() : "";
      const target = eq > 0 ? s.slice(eq + 1).trim() : "";
      if (!csvName || !target) {
        return {
          ok: false,
          error: `Owner alias must look like "Name in file=member" (got "${s}").`,
        };
      }
      const targetKey = normalizePersonKey(target);
      const match = members.find(
        (m) =>
          m.user_id === target || normalizePersonKey(m.full_name) === targetKey,
      );
      if (!match) {
        return {
          ok: false,
          error: `Owner alias target "${target}" is not a member of this team.`,
        };
      }
      ownerAliases.set(normalizePersonKey(csvName), match.user_id);
    }

    const received = await Promise.all(
      uploads.map(async (f) => ({
        name: f.name,
        bytes: Buffer.from(await f.arrayBuffer()),
      })),
    );
    const { files, notices: unpackNotices } = expandUploads(received);
    const asOf = new Date();
    const { tables, notices: readNotices } = readBulkTables(files, asOf);
    const notices = [...unpackNotices, ...readNotices];

    if (tables.length === 0) {
      return {
        ok: false,
        error:
          notices.length > 0
            ? `Nothing to import. ${notices.map((n) => `${n.file}: ${n.message}`).join(" · ")}`
            : "No data rows found. Check that the first row is headers and there is at least one data row.",
      };
    }

    const { rockTeam, notice } = teamFilterFor(tables, kinds, team.name);
    if (notice) notices.push(notice);
    const { inputs, refs } = assembleBulkInputs(tables, kinds, exclude);

    // An applied import is recorded before it writes anything; if the record
    // can't be written, startImportRun throws and nothing is imported.
    const runRef = dryRun
      ? null
      : await startImportRun(db, {
          teamId,
          actorUid,
          files: received,
          tables: tables.map((t) => ({
            id: t.id,
            kind: kinds.has(t.id) ? kinds.get(t.id)! : t.detected,
            rows: t.table.rows.length,
            excluded: t.table.rows.filter((_, i) =>
              exclude.has(rowKey(t.id, i)),
            ).length,
          })),
          options: {
            includeArchived,
            createOwners,
            unmatchedOwner,
            fallbackOwnerId,
            teamFilter: rockTeam ?? null,
            ownerAliases: Object.fromEntries(ownerAliases),
          },
        });

    let report;
    try {
      report = await runTeamImport(db, teamId, inputs, {
        dryRun,
        actorUid,
        createOwners,
        fallbackOwnerId,
        includeArchived,
        rockTeam,
        unmatchedOwner,
        ownerAliases: ownerAliases.size > 0 ? ownerAliases : undefined,
        asOf,
        // The grid shows every row's verdict; GRID_ROW_CAP bounds the cells.
        previewLimit: 20_000,
        rowRefs: refs,
        importRunId: runRef?.id ?? null,
      });
    } catch (err) {
      // Batches of 400 commit as they fill, so a failure can leave a partial
      // import — the record says so, and import_run_id finds what landed.
      if (runRef) {
        await finishImportRun(runRef, actorUid, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
    if (runRef) await finishImportRun(runRef, actorUid, { report });

    if (!dryRun) revalidateTeam(teamId);

    return {
      ok: true,
      report,
      tables: toGridTables(tables, kinds, asOf),
      notices,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return { ok: false, error: message };
  }
}
