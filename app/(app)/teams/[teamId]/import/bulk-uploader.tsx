"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileArchive,
  FileSpreadsheet,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SelectMenu } from "@/components/ui/select-menu";
import type {
  BulkGridTable,
  ImportKind,
  ImportReport,
  PreviewRow,
} from "@/lib/team-import-types";
import { importTeamBundle } from "./actions";
import { SKIP_ROWS, type BulkImportResult } from "./import-types";

const ACCEPT = /\.(zip|xlsx|csv|tsv)$/i;
// Mirrors MAX_BYTES in actions.ts (Server Action body limit is 1 MB). Checked
// here too: past the limit Next rejects the request before the action runs,
// with an error that means nothing to the person importing.
const MAX_BYTES = 950 * 1024;
// Re-preview this long after the last change (option, untick).
const PREVIEW_DEBOUNCE_MS = 500;

/**
 * What the Team picker carries to the next team's Import page. Switching
 * teams navigates (the page loads that team's members), which remounts this
 * component; a client-side navigation keeps this module — and the dropped
 * File objects — alive, so the files and checkboxes ride along. Aliases and
 * the unmatched-owner choice name members of the old team, so they don't.
 */
const carry: { current: { files: File[]; includeArchived: boolean; createOwners: boolean } | null } = {
  current: null,
};

type MemberOption = { user_id: string; full_name: string };
type OwnerAliasRow = { csvName: string; memberId: string };

const KIND_LABELS: Record<ImportKind, string> = {
  rocks: "Rocks",
  milestones: "Milestones",
  todos: "To-Dos",
  issues: "Issues",
  headlines: "Headlines",
  scorecard: "Scorecard",
};

/** Same shape as rowKey() in lib/team-import/bulk.ts (server-only module). */
const rowKey = (tableId: string, row: number) => `${tableId}#${row}`;

export function BulkUploader({
  teamId,
  teamName,
  canCreateOwners,
  importableTeams,
  members,
}: {
  teamId: string;
  teamName: string;
  /** Admin-only: leaders' imports never create placeholder people. */
  canCreateOwners: boolean;
  /** Teams this user may import into: all for an admin, else teams they lead. */
  importableTeams: { id: string; name: string }[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>(() => carry.current?.files ?? []);
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [createOwners, setCreateOwners] = useState(() => carry.current?.createOwners ?? false);
  const [includeArchived, setIncludeArchived] = useState(() => carry.current?.includeArchived ?? false);
  // Read once on mount (above), then dropped so a later visit starts clean.
  useEffect(() => {
    carry.current = null;
  }, []);
  const [fallbackOwnerId, setFallbackOwnerId] = useState("");
  const [aliases, setAliases] = useState<OwnerAliasRow[]>(() => [
    { csvName: "", memberId: "" },
  ]);
  const [exclude, setExclude] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<BulkImportResult | null>(null);
  // The buildForm (i.e. the exact files + options) the current result came
  // from. Any change makes a new buildForm, so the preview is stale until
  // the run for it comes back — Import only applies what was looked at.
  const [resultFor, setResultFor] = useState<unknown>(null);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);

  const buildForm = useCallback(
    (dryRun: boolean) => {
      const fd = new FormData();
      for (const f of files) fd.append("file", f);
      fd.set("dryRun", dryRun ? "1" : "0");
      fd.set("createOwners", canCreateOwners && createOwners ? "1" : "0");
      fd.set("includeArchived", includeArchived ? "1" : "0");
      if (fallbackOwnerId) fd.set("fallbackOwnerId", fallbackOwnerId);
      for (const a of aliases) {
        const csv = a.csvName.trim();
        const mid = a.memberId.trim();
        if (csv && mid) fd.append("ownerAlias", `${csv}=${mid}`);
      }
      fd.set("exclude", JSON.stringify([...exclude]));
      return fd;
    },
    [files, canCreateOwners, createOwners, includeArchived, fallbackOwnerId, aliases, exclude],
  );

  const run = useCallback(
    (dryRun: boolean) => {
      const mine = ++seq.current;
      const fd = buildForm(dryRun);
      startTransition(async () => {
        const res = await importTeamBundle(teamId, fd);
        // A later change already asked for a newer preview — drop this one.
        if (mine !== seq.current) return;
        setResult(res);
        setResultFor(() => buildForm);
      });
    },
    [buildForm, teamId],
  );

  // Any change re-runs the dry run, so the grid always shows what Import
  // would do right now.
  useEffect(() => {
    if (files.length === 0) return;
    const t = setTimeout(() => run(true), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [files, run]);

  const onPick = useCallback((list: FileList | null | undefined) => {
    const picked = [...(list ?? [])].filter((f) => f.size > 0);
    if (picked.length === 0) return;
    const bad = picked.filter((f) => !ACCEPT.test(f.name));
    if (bad.length > 0) {
      setPickError(`Not a .zip, .xlsx, .csv or .tsv: ${bad.map((f) => f.name).join(", ")}`);
    } else {
      setPickError(null);
    }
    const good = picked.filter((f) => ACCEPT.test(f.name));
    if (good.length === 0) return;
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const f of good) byName.set(f.name, f);
    const next = [...byName.values()];
    const total = next.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) {
      setPickError(
        `That's ${Math.round(total / 1024)} KB — the limit is ${MAX_BYTES / 1024} KB. Zip the files, or import them in two goes.`,
      );
      return;
    }
    setFiles(next);
    // New files mean new sheets: old row ticks no longer line up.
    setExclude(new Set());
  }, [files]);

  const clearAll = () => {
    seq.current++;
    setFiles([]);
    setResult(null);
    setExclude(new Set());
    setResultFor(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const memberOptions = useMemo(
    () => members.map((m) => ({ value: m.user_id, label: m.full_name || m.user_id })),
    [members],
  );

  const preview = result?.ok ? result : null;
  const stale = files.length > 0 && resultFor !== buildForm;
  const canImport = !!preview && preview.report.dryRun && !stale && !pending;

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-4 md:grid-cols-2">
        {/* Team + aliases + options */}
        <div className="space-y-4 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Team</span>
            <SelectMenu
              variant="field"
              options={importableTeams.map((t) => ({ value: t.id, label: t.name }))}
              value={teamId}
              onChange={(id) => {
                if (id === teamId) return;
                carry.current = files.length > 0 ? { files, includeArchived, createOwners } : null;
                router.push(`/teams/${id}/import`);
              }}
              disabled={importableTeams.length < 2}
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Owner name aliases
              </span>
              <button
                type="button"
                onClick={() => setAliases((prev) => [...prev, { csvName: "", memberId: "" }])}
                className="inline-flex items-center gap-1 text-xs font-medium text-hpb-blue hover:underline dark:text-hpb-gold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add alias
              </button>
            </div>
            <div className="space-y-2">
              {aliases.map((row, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
                  <input
                    type="text"
                    value={row.csvName}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAliases((prev) => prev.map((a, j) => (j === i ? { ...a, csvName: v } : a)));
                    }}
                    placeholder="Name in file"
                    className="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <span className="text-xs text-zinc-400">→</span>
                  <SelectMenu
                    variant="field"
                    options={memberOptions}
                    value={row.memberId || undefined}
                    placeholder="Choose member…"
                    aria-label={`Team member for ${row.csvName || "this name"}`}
                    onChange={(v) =>
                      setAliases((prev) => prev.map((a, j) => (j === i ? { ...a, memberId: v } : a)))
                    }
                    className="w-full min-w-0"
                  />
                  <button
                    type="button"
                    aria-label="Remove alias"
                    onClick={() => setAliases((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {canCreateOwners && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={createOwners}
                  onChange={(e) => setCreateOwners(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    Create placeholder members
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    For Owner names not on the team yet.
                  </span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              <span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  Include archived rows
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Off: rows with an Archived Date are skipped. On: they import already archived. A
                  re-import never changes the archive state of a row that is already here.
                </span>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Unmatched owner</span>
              <SelectMenu
                variant="field"
                options={[
                  {
                    value: "",
                    label: "Import with No Owner",
                    description: "Blank or unknown owners land unassigned; an unknown name is kept in the description",
                  },
                  {
                    value: SKIP_ROWS,
                    label: "Skip those rows",
                    description: "Rows whose owner is blank or not on the team aren't imported",
                  },
                  ...members.map((m) => ({
                    value: m.user_id,
                    label: `Park them on ${m.full_name || m.user_id}`,
                  })),
                ]}
                value={fallbackOwnerId}
                onChange={setFallbackOwnerId}
                className="w-full"
              />
            </label>
          </div>
        </div>

        {/* Dropzone */}
        <div className="space-y-2">
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onPick(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "relative flex min-h-[12rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragOver
                ? "border-hpb-blue bg-hpb-blue/5 dark:border-hpb-gold dark:bg-hpb-gold/5"
                : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500",
            )}
          >
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              multiple
              accept=".zip,.xlsx,.csv,.tsv,application/zip,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => onPick(e.target.files)}
            />
            {files.length > 0 ? (
              <>
                <div className="flex flex-wrap justify-center gap-2">
                  {files.map((f) => (
                    <span
                      key={f.name}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      {/\.zip$/i.test(f.name) ? (
                        <FileArchive className="h-3.5 w-3.5 text-hpb-blue dark:text-hpb-gold" />
                      ) : (
                        <FileSpreadsheet className="h-3.5 w-3.5 text-hpb-blue dark:text-hpb-gold" />
                      )}
                      {f.name}
                      <span className="text-zinc-500">{(f.size / 1024).toFixed(0)} KB</span>
                    </span>
                  ))}
                </div>
                <div className="text-xs text-zinc-500">Click or drop to add more files</div>
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearAll();
                  }}
                  aria-label="Remove all files"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-zinc-400" />
                <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Drop the ninety export here — a .zip, or all the .xlsx / .csv files at once
                </div>
                <div className="text-xs text-zinc-500">
                  Scorecard, Rocks (+ Milestones tab), To-Dos, Issues (short + long tabs), Headlines ·
                  each tab is recognized by its columns · max 950 KB
                </div>
              </>
            )}
          </div>
          {pickError && <ErrorBox message={pickError} />}
        </div>
      </div>

      {/* Status + actions */}
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canImport}
            onClick={() => {
              if (!preview) return;
              const n = countPlanned(preview.report);
              if (
                !window.confirm(
                  `Import ${n} row${n === 1 ? "" : "s"} into ${teamName}? Rows already on the team keep their current values — only new rows are added.`,
                )
              ) {
                return;
              }
              run(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </button>
          <span className="text-xs text-zinc-500">
            {pending || stale
              ? "Updating the preview…"
              : preview?.report.dryRun
                ? "Preview is current — nothing has been written yet."
                : preview
                  ? "Imported. Change anything above to preview again."
                  : null}
          </span>
        </div>
      )}

      {result && !result.ok && <ErrorBox message={result.error} />}
      {preview && (
        <ResultView
          result={preview}
          exclude={exclude}
          setExclude={setExclude}
          updating={stale}
        />
      )}
    </div>
  );
}

/**
 * Rows the file assigns to another team (its Team column). They are skipped,
 * not imported anywhere — said up front so nobody assumes they landed.
 */
function OtherTeamsBanner({ rows }: { rows: PreviewRow[] }) {
  const byTeam = new Map<string, Map<ImportKind, number>>();
  let total = 0;
  for (const r of rows) {
    if (!r.otherTeam) continue;
    const kinds = byTeam.get(r.otherTeam) ?? new Map<ImportKind, number>();
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    byTeam.set(r.otherTeam, kinds);
    total++;
  }
  if (total === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">
          {total} record{total === 1 ? " is" : "s are"} for other teams and will not be imported
        </p>
        <ul className="mt-1 space-y-0.5 text-xs">
          {[...byTeam].map(([team, kinds]) => (
            <li key={team}>
              <span className="font-medium">{team}:</span>{" "}
              {[...kinds].map(([k, n]) => `${n} ${KIND_LABELS[k]}`).join(", ")}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs">
          They&apos;re marked skipped in the grid. Import them from that team&apos;s Import page.
        </p>
      </div>
    </div>
  );
}

function countPlanned(report: ImportReport): number {
  return report.kinds.reduce((n, k) => n + k.imported, 0);
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result: summary + grid
// ---------------------------------------------------------------------------

function ResultView({
  result,
  exclude,
  setExclude,
  updating,
}: {
  result: Extract<BulkImportResult, { ok: true }>;
  exclude: Set<string>;
  setExclude: (fn: (prev: Set<string>) => Set<string>) => void;
  /** A newer preview is on its way — say so, but keep the grid usable. */
  updating: boolean;
}) {
  const { report, tables, notices } = result;
  const [active, setActive] = useState(0);
  const table = tables[Math.min(active, tables.length - 1)];

  // Verdict per file row. A row can yield more than one preview line (rare);
  // the last one is the outcome.
  const verdicts = useMemo(() => {
    const m = new Map<string, PreviewRow>();
    for (const r of report.rows) if (r.ref) m.set(rowKey(r.ref.table, r.ref.row), r);
    return m;
  }, [report.rows]);

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900",
      )}
    >
      <div className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-hpb-green" />
        <div>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {report.dryRun ? "Preview" : "Import complete"} — {countPlanned(report)} row
            {countPlanned(report) === 1 ? "" : "s"} {report.dryRun ? "will be added" : "added"}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {report.kinds.map((k, i) => (
              <li key={`${k.label}-${i}`}>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{k.label}:</span>{" "}
                {k.imported} {report.dryRun ? "to add" : "added"}
                {k.unchanged ? `, ${k.unchanged} already here` : ""}
                {k.skipped ? `, ${k.skipped} skipped` : ""}
                {k.details.length > 0 ? ` (${k.details.join("; ")})` : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <OtherTeamsBanner rows={report.rows} />

      {(report.kinds.some((k) => k.warnings.length > 0) ||
        report.unresolvedOwners.length > 0 ||
        report.collisions > 0 ||
        notices.length > 0) && (
        <div className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
          {report.kinds.flatMap((k, i) => k.warnings.map((w, j) => <p key={`${i}-${j}`}>⚠ {w}</p>))}
          {report.collisions > 0 && (
            <p>
              ⚠ {report.collisions} row{report.collisions === 1 ? "" : "s"} share a record with
              an earlier row in this upload (same title — and, in archived files, same dates).
              Only the last of each is kept.
            </p>
          )}
          {report.unresolvedOwners.length > 0 && (
            <p>⚠ Owners not on the team: {report.unresolvedOwners.join(", ")}</p>
          )}
          {notices.map((n, i) => (
            <p key={`n-${i}`}>
              ⚠ {n.file}: {n.message}
            </p>
          ))}
        </div>
      )}
      {report.placeholdersCreated.length > 0 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Placeholder members: {report.placeholdersCreated.map((c) => c.name).join(", ")}
        </p>
      )}

      {table && (
        <SheetGrid
          key={table.id}
          table={table}
          verdicts={verdicts}
          exclude={exclude}
          setExclude={setExclude}
          applied={!report.dryRun}
          updating={updating}
        />
      )}

      {/* Sheet tabs, Excel-style */}
      <div className="-mt-px flex flex-wrap gap-px overflow-x-auto border-t border-zinc-200 pt-0 dark:border-zinc-800">
        {tables.map((t, i) => {
          const stats = tabStats(t, verdicts, exclude);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(i)}
              title={t.id}
              className={cn(
                "flex items-center gap-1.5 rounded-b-md border border-t-0 px-3 py-1.5 text-xs",
                i === active
                  ? "border-zinc-300 bg-white font-semibold text-hpb-blue dark:border-zinc-700 dark:bg-zinc-900 dark:text-hpb-gold"
                  : "border-transparent bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700",
              )}
            >
              <span>
                {t.kind ? KIND_LABELS[t.kind] : "Left out"}
                {t.archived ? " (archived)" : ""}
              </span>
              <span className="max-w-[12rem] truncate font-normal text-zinc-500">
                {t.sheet ?? t.file.split("/").pop()}
              </span>
              <span className="rounded bg-zinc-200 px-1 font-normal text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                {t.totalRows}
              </span>
              {stats.problems > 0 && (
                <span className="rounded bg-amber-100 px-1 font-normal text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                  {stats.problems} ⚠
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type Verdict = { label: string; tone: "new" | "update" | "kept" | "skip" | "off" | "none"; note?: string };

function verdictFor(v: PreviewRow | undefined, excluded: boolean, kind: ImportKind | null, applied: boolean): Verdict {
  if (!kind) return { label: "Left out", tone: "off", note: "This tab isn't being imported" };
  if (excluded) return { label: "Unticked", tone: "off" };
  if (!v) return { label: "Not read", tone: "skip", note: "No title — the importer can't use this row" };
  if (v.action === "create") return { label: applied ? "Added" : "New", tone: "new", note: v.note };
  if (v.action === "update") return { label: applied ? "Updated" : "Update", tone: "update", note: v.note };
  if (/^Already on the team/.test(v.note ?? "")) return { label: "Already here", tone: "kept", note: v.note };
  return { label: "Skipped", tone: "skip", note: v.note };
}

const TONE: Record<Verdict["tone"], string> = {
  new: "bg-[rgba(44,179,74,.10)] text-[#177a3d] ring-[rgba(44,179,74,.35)] dark:bg-[rgba(44,179,74,.15)] dark:text-hpb-green",
  update: "bg-[rgba(0,51,160,.08)] text-hpb-blue ring-[rgba(0,51,160,.30)] dark:bg-[rgba(0,51,160,.20)] dark:text-white",
  kept: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  skip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900",
  off: "bg-zinc-50 text-zinc-400 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-zinc-800",
  none: "",
};

function isProblem(v: Verdict, owner: string | undefined, badCols: Set<number> | undefined): boolean {
  return v.tone === "skip" || owner === "No Owner" || (badCols?.size ?? 0) > 0;
}

function badCellIndex(t: BulkGridTable): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const [r, c] of t.badCells) {
    if (!m.has(r)) m.set(r, new Set());
    m.get(r)!.add(c);
  }
  return m;
}

function tabStats(t: BulkGridTable, verdicts: Map<string, PreviewRow>, exclude: Set<string>) {
  const bad = badCellIndex(t);
  let problems = 0;
  for (let r = 0; r < t.rows.length; r++) {
    const key = rowKey(t.id, r);
    const pv = verdicts.get(key);
    const v = verdictFor(pv, exclude.has(key), t.kind, false);
    if (t.kind && isProblem(v, pv?.owner, bad.get(r))) problems++;
  }
  return { problems };
}

function SheetGrid({
  table,
  verdicts,
  exclude,
  setExclude,
  applied,
  updating,
}: {
  table: BulkGridTable;
  verdicts: Map<string, PreviewRow>;
  exclude: Set<string>;
  setExclude: (fn: (prev: Set<string>) => Set<string>) => void;
  applied: boolean;
  updating: boolean;
}) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const bad = useMemo(() => badCellIndex(table), [table]);

  const rows = table.rows.map((cells, r) => {
    const key = rowKey(table.id, r);
    const pv = verdicts.get(key);
    const excluded = exclude.has(key);
    const v = verdictFor(pv, excluded, table.kind, applied);
    return { r, key, cells, pv, excluded, v, problem: isProblem(v, pv?.owner, bad.get(r)) };
  });
  const shown = onlyProblems ? rows.filter((x) => x.problem) : rows;
  const allTicked = shown.every((x) => !x.excluded);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-zinc-500">
          {table.detected
            ? `Detected ${KIND_LABELS[table.detected]} — ${table.reason}`
            : table.reason}
        </span>
        {table.archived && table.kind && (
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            Archived export — every row lands in the Archived view
          </span>
        )}
        {updating && (
          <span className="inline-flex items-center gap-1 text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating…
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Only rows that need a look
        </label>
      </div>

      {/* Wide content scrolls inside its own box, never the page. */}
      <div className="max-h-[36rem] overflow-auto rounded-md border border-zinc-300 dark:border-zinc-700">
        <table className="border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-20 bg-zinc-100 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <tr>
              <th className="sticky left-0 z-30 border-b border-r border-zinc-300 bg-zinc-100 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
                <label
                  className="flex items-center gap-1.5 font-semibold"
                  title="Ticked rows are imported; untick a row to leave it out"
                >
                <input
                  type="checkbox"
                  aria-label="Import every row shown"
                  disabled={!table.kind || shown.length === 0}
                  checked={allTicked}
                  onChange={() =>
                    setExclude((prev) => {
                      const next = new Set(prev);
                      for (const x of shown) {
                        if (allTicked) next.add(x.key);
                        else next.delete(x.key);
                      }
                      return next;
                    })
                  }
                />
                Import
                </label>
              </th>
              <th className="border-b border-r border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700">Result</th>
              <th className="border-b border-r border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700">Owner →</th>
              {table.headers.map((h, c) => (
                <th
                  key={c}
                  title={table.used[c] ? undefined : "Not imported — this column isn't read"}
                  className={cn(
                    "whitespace-nowrap border-b border-r border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700",
                    !table.used[c] && "font-normal italic text-zinc-400 dark:text-zinc-500",
                  )}
                >
                  {h || "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr
                key={x.r}
                className={cn(
                  "align-top",
                  x.excluded && "text-zinc-400 line-through dark:text-zinc-600",
                )}
              >
                <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500 no-underline dark:border-zinc-800 dark:bg-zinc-900">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      disabled={!table.kind || applied}
                      checked={!x.excluded}
                      onChange={() =>
                        setExclude((prev) => {
                          const next = new Set(prev);
                          if (next.has(x.key)) next.delete(x.key);
                          else next.add(x.key);
                          return next;
                        })
                      }
                      aria-label={`Import row ${x.r + 2}`}
                    />
                    {/* Spreadsheet row number: header is row 1. */}
                    {x.r + 2}
                  </label>
                </td>
                <td className="min-w-[9rem] max-w-[18rem] border-b border-r border-zinc-200 px-2 py-1 dark:border-zinc-800">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-px text-[10.5px] font-bold ring-1 ring-inset",
                      TONE[x.v.tone],
                    )}
                  >
                    {x.v.label}
                  </span>
                  {x.v.note && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{x.v.note}</span>
                  )}
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap border-b border-r border-zinc-200 px-2 py-1 dark:border-zinc-800",
                    x.pv?.owner === "No Owner"
                      ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                      : "text-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {x.pv && x.pv.owner !== "—" ? x.pv.owner : ""}
                </td>
                {x.cells.map((v, c) => {
                  const isBad = bad.get(x.r)?.has(c);
                  return (
                    <td
                      key={c}
                      title={isBad ? "Can't read this date — it will be left blank" : v.length > 60 ? v : undefined}
                      className={cn(
                        "max-w-[22rem] border-b border-r border-zinc-200 px-2 py-1 dark:border-zinc-800",
                        !table.used[c] && "bg-zinc-50 text-zinc-400 dark:bg-zinc-900/60 dark:text-zinc-600",
                        isBad && "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
                      )}
                    >
                      <span className="line-clamp-2">{v}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={table.headers.length + 3} className="px-3 py-6 text-center text-zinc-500">
                  {onlyProblems ? "Nothing needs a look on this tab." : "No rows."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {table.totalRows > table.rows.length && (
        <p className="text-xs text-zinc-500">
          Showing the first {table.rows.length} of {table.totalRows} rows. Every row is imported;
          the counts above cover all of them.
        </p>
      )}
    </div>
  );
}
