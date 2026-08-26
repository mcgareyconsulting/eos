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
  FileSpreadsheet,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EXPECTED_HEADERS, type WebImportKind } from "@/lib/import-headers";
import { importTeamFile } from "./actions";
import { SKIP_ROWS, type ImportActionResult } from "./import-types";
import type { PreviewRow } from "@/lib/team-import-types";

// Sentinel for the "Other…" option — a Department value the app has no team
// for. Cannot collide with a real team name.
const CUSTOM_DEPT = "\u0000custom";

type MemberOption = { user_id: string; full_name: string };
type OwnerAliasRow = { csvName: string; memberId: string };

const KINDS: {
  id: WebImportKind;
  label: string;
  blurb: string;
}[] = [
  {
    id: "rocks",
    label: "Rocks",
    blurb:
      "Quarterly rocks. A rocks + milestones workbook imports both sheets in one pass.",
  },
  {
    id: "todos",
    label: "To-Dos",
    blurb: "Standalone to-dos — milestones ride along with a rocks workbook.",
  },
  {
    id: "issues",
    label: "Issues",
    blurb: "Short- and long-term issues. Multi-sheet .xlsx imports both sheets.",
  },
  {
    id: "headlines",
    label: "Headlines",
    blurb:
      "Cascading, customer, and employee headlines. Multi-sheet .xlsx imports every headline sheet.",
  },
  {
    id: "scorecard",
    label: "Scorecard",
    blurb:
      "Measurables and their week-by-week history in one file. Group Name becomes the measurable's group. Everything imports as weekly.",
  },
];

function findStephanie(members: MemberOption[]): string {
  const hit = members.find((m) =>
    /stephanie\s+benes/i.test(m.full_name ?? ""),
  );
  return hit?.user_id ?? "";
}

export function ImportUploader({
  teamId,
  teamName,
  orgTeams,
  importableTeams,
  members,
}: {
  teamId: string;
  teamName: string;
  /** Every team name — used to match the file's Department column. */
  orgTeams: { id: string; name: string }[];
  /** Teams this user may import into: all for an admin, else teams they lead. */
  importableTeams: { id: string; name: string }[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<WebImportKind>("rocks");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [createOwners, setCreateOwners] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [fallbackOwnerId, setFallbackOwnerId] = useState("");
  // Multi-department exports carry a ninety Team/Department column. Default to
  // the team whose Import page this is — the old hardcoded "Enterprise Systems
  // & Data" silently filtered every other team's upload down to nothing (N6).
  const [rockTeam, setRockTeam] = useState(teamName);
  // Escape hatch: the file's Department values don't always match app team
  // names, so "Other…" reveals a text box rather than trapping the user.
  const [rockTeamCustom, setRockTeamCustom] = useState(false);
  const defaultStephId = useMemo(() => findStephanie(members), [members]);
  const [aliases, setAliases] = useState<OwnerAliasRow[]>(() => [
    { csvName: "Steph Benes", memberId: findStephanie(members) },
  ]);
  const [result, setResult] = useState<ImportActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const expected = EXPECTED_HEADERS[kind];

  // Fill Steph → Stephanie once members are available.
  useEffect(() => {
    if (!defaultStephId) return;
    setAliases((prev) => {
      const idx = prev.findIndex(
        (a) => a.csvName.trim().toLowerCase() === "steph benes",
      );
      if (idx < 0) return prev;
      if (prev[idx].memberId) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], memberId: defaultStephId };
      return next;
    });
  }, [defaultStephId]);

  const onPick = useCallback((f: File | null | undefined) => {
    setResult(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!/\.(csv|tsv|xlsx)$/i.test(f.name)) {
      setResult({
        ok: false,
        error: "Use a .csv, .tsv, or .xlsx file.",
      });
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const run = (dryRun: boolean) => {
    if (!file) {
      setResult({ ok: false, error: "Drop or choose a file first." });
      return;
    }
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    fd.set("dryRun", dryRun ? "1" : "0");
    fd.set("createOwners", createOwners ? "1" : "0");
    fd.set("includeArchived", includeArchived ? "1" : "0");
    if (fallbackOwnerId) fd.set("fallbackOwnerId", fallbackOwnerId);
    if (rockTeam.trim()) fd.set("rockTeam", rockTeam.trim());
    for (const a of aliases) {
      const csv = a.csvName.trim();
      const mid = a.memberId.trim();
      if (csv && mid) fd.append("ownerAlias", `${csv}=${mid}`);
    }

    startTransition(async () => {
      const res = await importTeamFile(teamId, fd);
      setResult(res);
    });
  };

  return (
    <div className="space-y-6">
      {/* Kind tabs */}
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => {
              setKind(k.id);
              setResult(null);
            }}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              kind === k.id
                ? "border-hpb-blue bg-hpb-blue/10 text-hpb-blue dark:border-hpb-gold dark:bg-hpb-gold/10 dark:text-hpb-gold"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {KINDS.find((k) => k.id === kind)?.blurb}
      </p>

      {/* Dropzone */}
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
          onPick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragOver
            ? "border-hpb-blue bg-hpb-blue/5 dark:border-hpb-gold dark:bg-hpb-gold/5"
            : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500",
        )}
      >
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        {file ? (
          <>
            <FileSpreadsheet className="h-8 w-8 text-hpb-blue dark:text-hpb-gold" />
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {file.name}
            </div>
            <div className="text-xs text-zinc-500">
              {(file.size / 1024).toFixed(1)} KB · click or drop to replace
            </div>
            <button
              type="button"
              className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                setResult(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-zinc-400" />
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Drop a .csv or .xlsx here
            </div>
            <div className="text-xs text-zinc-500">or click to browse · max 8 MB</div>
          </>
        )}
      </div>

      {/* Options */}
      <div className="grid gap-4 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Import into
          </span>
          <select
            value={teamId}
            onChange={(e) => router.push(`/teams/${e.target.value}/import`)}
            disabled={importableTeams.length < 2}
            className="max-w-lg rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
          >
            {importableTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            The team these rows land on. Switching opens that team&rsquo;s
            Import page.{" "}
            {importableTeams.length < 2
              ? "You can import into the teams you lead; an admin can import into any team."
              : null}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Only rows for
          </span>
          {rockTeamCustom ? (
            <input
              type="text"
              value={rockTeam}
              onChange={(e) => {
                setRockTeam(e.target.value);
                setResult(null);
              }}
              placeholder="Department value as it appears in the file"
              className="max-w-lg rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          ) : (
            <select
              value={rockTeam}
              onChange={(e) => {
                if (e.target.value === CUSTOM_DEPT) {
                  setRockTeamCustom(true);
                  setRockTeam("");
                } else {
                  setRockTeam(e.target.value);
                }
                setResult(null);
              }}
              className="max-w-lg rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">Every row in the file</option>
              {orgTeams.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
              <option value={CUSTOM_DEPT}>Other…</option>
            </select>
          )}
          <span className="text-xs text-zinc-500">
            Ninety exports every department in one file. Only rows whose{" "}
            <code className="text-[11px]">Team</code> /{" "}
            <code className="text-[11px]">Department</code> column matches are
            imported (case-insensitive). Level=Department rocks still land in
            the Department section even when owned by someone else.
            {rockTeamCustom ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => {
                    setRockTeamCustom(false);
                    setRockTeam(teamName);
                    setResult(null);
                  }}
                  className="font-semibold underline hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Back to the team list
                </button>
              </>
            ) : null}
          </span>
        </label>

        <div className="sm:col-span-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Owner name aliases
            </span>
            <button
              type="button"
              onClick={() =>
                setAliases((prev) => [...prev, { csvName: "", memberId: "" }])
              }
              className="inline-flex items-center gap-1 text-xs font-medium text-hpb-blue hover:underline dark:text-hpb-gold"
            >
              <Plus className="h-3.5 w-3.5" />
              Add alias
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Map a name from the spreadsheet to a team member (e.g.{" "}
            <em>Steph Benes</em> → <em>Stephanie Benes</em>).
          </p>
          <div className="space-y-2">
            {aliases.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={row.csvName}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAliases((prev) =>
                      prev.map((a, j) =>
                        j === i ? { ...a, csvName: v } : a,
                      ),
                    );
                    setResult(null);
                  }}
                  placeholder="Name in file"
                  className="min-w-[10rem] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <span className="text-xs text-zinc-400">→</span>
                <select
                  value={row.memberId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAliases((prev) =>
                      prev.map((a, j) =>
                        j === i ? { ...a, memberId: v } : a,
                      ),
                    );
                    setResult(null);
                  }}
                  className="min-w-[12rem] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">Choose member…</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name || m.user_id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove alias"
                  onClick={() =>
                    setAliases((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

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
              For Owner names not on the team yet. Leave off to skip those rows
              (or use a fallback below).
            </span>
          </span>
        </label>
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
              Off: rows with an Archived Date (or an archived status) are
              skipped and counted as &ldquo;held back&rdquo;. On: they import
              already archived, dated from their Archived Date — they land in
              the Archived view, not your active lists. Either way a re-import
              never changes the archive state of a row that is already here, so
              anything you archived in the app stays archived.
            </span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Unmatched owner
          </span>
          <select
            value={fallbackOwnerId}
            onChange={(e) => setFallbackOwnerId(e.target.value)}
            className="max-w-md rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">
              Import with No Owner (keeps the name in the description)
            </option>
            <option value={SKIP_ROWS}>Skip rows with unknown owners</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                Park them on {m.full_name || m.user_id}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            When an Owner name matches nobody on the team. The default keeps
            the row and the name — a departed employee&rsquo;s work still lands,
            unassigned, instead of disappearing from the import.
          </span>
        </label>

        <p className="text-xs text-zinc-500 sm:col-span-2">
          Rows already on this team are always left as they are — an import
          only adds what is new, so re-uploading the same export never
          overwrites edits made in the app. The preview marks them
          &ldquo;Skipped&rdquo;.
        </p>
      </div>

      {/* Expected columns */}
      <div className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950/50">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
          Expected columns
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Headers are matched case-insensitively. Extra columns are ignored.
          Synonyms work (e.g. Title / Name, Owner / Accountable).
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {expected.required.map((h) => (
            <span
              key={h}
              className="rounded-md bg-hpb-blue/10 px-2 py-0.5 text-xs font-medium text-hpb-blue dark:bg-hpb-gold/10 dark:text-hpb-gold"
            >
              {h} *
            </span>
          ))}
          {expected.optional.map((h) => (
            <span
              key={h}
              className="rounded-md bg-zinc-200/80 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {h}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{expected.notes}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !file}
          onClick={() => run(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Preview (dry run)
        </button>
        <button
          type="button"
          disabled={pending || !file}
          onClick={() => {
            if (
              !window.confirm(
                `Import ${kind} from “${file?.name}” into this team? Rows already on the team keep their current values — only new rows are added.`,
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
      </div>

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: ImportActionResult }) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{result.error}</span>
      </div>
    );
  }

  const { report, preview } = result;
  return (
    <div className="space-y-3 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-hpb-green" />
        <div>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {report.dryRun ? "Dry run complete" : "Import complete"} —{" "}
            {report.writes} write{report.writes === 1 ? "" : "s"}
            {report.dryRun ? " planned" : " applied"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {preview.filename} · {preview.rowCount} data row
            {preview.rowCount === 1 ? "" : "s"}
            {preview.sheets.length > 0
              ? ` · sheets: ${preview.sheets.join(", ")}`
              : ""}
          </p>
        </div>
      </div>

      <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        {report.kinds.map((k) => (
          <li key={k.label}>
            <span className="font-medium">{k.label}:</span> {k.imported} imported
            {k.unchanged ? `, ${k.unchanged} kept as-is` : ""}
            {k.skipped ? `, ${k.skipped} skipped` : ""}
            {k.details.length > 0 ? ` (${k.details.join("; ")})` : ""}
          </li>
        ))}
      </ul>

      {report.kinds.some((k) => k.warnings.length > 0) && (
        <div className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
          {report.kinds.flatMap((k) =>
            k.warnings.map((w, i) => (
              <p key={`${k.label}-${i}`}>⚠ {w}</p>
            )),
          )}
        </div>
      )}

      {report.placeholdersCreated.length > 0 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Placeholder members:{" "}
          {report.placeholdersCreated.map((c) => c.name).join(", ")}
        </p>
      )}

      {report.unresolvedOwners.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Unresolved owners (rows skipped):{" "}
          {report.unresolvedOwners.join(", ")}
        </p>
      )}

      {report.rows.length > 0 && (
        <PreviewTable
          rows={report.rows}
          truncated={report.previewTruncated}
          dryRun={report.dryRun}
        />
      )}

      {preview.headers.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300">
            Detected headers
          </summary>
          <p className="mt-1 font-mono">{preview.headers.join(", ")}</p>
        </details>
      )}

      {report.dryRun && (
        <p className="text-xs text-zinc-500">
          Nothing was written. Click <strong>Import</strong> to apply.
        </p>
      )}
    </div>
  );
}

const ACTION_STYLES: Record<PreviewRow["action"], string> = {
  create:
    "bg-[rgba(44,179,74,.10)] text-[#177a3d] ring-[rgba(44,179,74,.35)] dark:bg-[rgba(44,179,74,.15)] dark:text-hpb-green",
  update:
    "bg-[rgba(0,51,160,.08)] text-hpb-blue ring-[rgba(0,51,160,.30)] dark:bg-[rgba(0,51,160,.20)] dark:text-white",
  skip: "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
};

const ACTION_LABELS: Record<PreviewRow["action"], string> = {
  create: "New",
  update: "Update",
  skip: "Skipped",
};

/**
 * Row-by-row view of what the importer read: the resolved owner, the fields
 * that decide where the row lands, and what will happen to it. This is the
 * point of a dry run — the old panel showed only a filename and a write
 * count, which never answered "did it map my columns correctly?".
 */
function PreviewTable({
  rows,
  truncated,
  dryRun,
}: {
  rows: PreviewRow[];
  truncated: number;
  dryRun: boolean;
}) {
  const skipped = rows.filter((r) => r.action === "skip").length;
  return (
    <details open className="text-sm">
      <summary className="cursor-pointer font-medium text-zinc-900 hover:text-hpb-blue dark:text-zinc-100 dark:hover:text-hpb-gold">
        {dryRun ? "What will land" : "What landed"} — {rows.length} row
        {rows.length === 1 ? "" : "s"}
        {skipped > 0 ? ` · ${skipped} skipped` : ""}
      </summary>

      {/* Wide content scrolls inside its own box, never the page. */}
      <div className="mt-2 max-h-[32rem] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead className="sticky top-0 bg-zinc-50 text-[10.5px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th className="px-2.5 py-1.5 font-semibold">Title</th>
              <th className="px-2.5 py-1.5 font-semibold">Owner</th>
              <th className="px-2.5 py-1.5 font-semibold">Details</th>
              <th className="px-2.5 py-1.5 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.kind}-${i}`}
                className="border-t border-zinc-100 align-top dark:border-zinc-800"
              >
                <td className="max-w-[40rem] px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200">
                  <span className="line-clamp-2">{r.title || "—"}</span>
                  {r.note ? (
                    <span className="mt-0.5 block text-[11px] text-zinc-500">
                      {r.note}
                    </span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-2.5 py-1.5",
                    r.owner === "No Owner"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {r.owner}
                </td>
                <td className="px-2.5 py-1.5 text-zinc-500">
                  {r.detail.join(" · ") || "—"}
                </td>
                <td className="px-2.5 py-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-px text-[10.5px] font-bold ring-1 ring-inset",
                      ACTION_STYLES[r.action],
                    )}
                  >
                    {ACTION_LABELS[r.action]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {truncated > 0 && (
        <p className="mt-1 text-xs text-zinc-500">
          {truncated} more row{truncated === 1 ? "" : "s"} not listed. Counts
          above cover every row.
        </p>
      )}
    </details>
  );
}
