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
import type { ImportActionResult } from "./import-types";

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
    blurb: "Quarterly rocks — re-import updates existing rocks matched by title.",
  },
  {
    id: "todos",
    label: "To-Dos",
    blurb: "Standalone to-dos (not milestones). Matched by title on re-import.",
  },
  {
    id: "issues",
    label: "Issues",
    blurb: "Short- and long-term issues. Multi-sheet .xlsx imports both sheets.",
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
  members,
}: {
  teamId: string;
  teamName: string;
  orgTeams: { id: string; name: string }[];
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
  // Re-dropping the ninety workbook to pull milestones in shouldn't rewrite
  // rocks the team has edited in the app since the first import (N6).
  const [skipExistingRocks, setSkipExistingRocks] = useState(false);
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
    if (kind === "rocks") {
      fd.set("existingRocks", skipExistingRocks ? "skip" : "update");
    }
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
            className="max-w-lg rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {orgTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            The team these rows land on. Switching opens that team&rsquo;s
            Import page.
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
              By default rows with an Archived Date (or archived status) are
              skipped.
            </span>
          </span>
        </label>
        {kind === "rocks" && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={skipExistingRocks}
              onChange={(e) => setSkipExistingRocks(e.target.checked)}
            />
            <span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                Keep rocks already on the team
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Re-uploading a rocks + milestones workbook: leave existing rocks
                exactly as they are and only fill in the milestones. Off means
                matching rocks are rewritten from the file.
              </span>
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Unmatched owner fallback
          </span>
          <select
            value={fallbackOwnerId}
            onChange={(e) => setFallbackOwnerId(e.target.value)}
            className="max-w-md rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Skip rows with unknown owners</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name || m.user_id}
              </option>
            ))}
          </select>
        </label>
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
                `Import ${kind} from “${file?.name}” into this team? ${
                kind === "rocks" && skipExistingRocks
                  ? "Rocks already on the team keep their current values."
                  : "Existing imported rows with the same title will be updated."
              }`,
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
