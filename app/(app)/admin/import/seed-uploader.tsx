"use client";

import { useCallback, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/text";
import type { SeedReport } from "@/lib/user-import-types";
import { importSeedFile } from "./actions";
import { SEED_FILE_COLUMNS, type SeedImportResult } from "./import-types";

export function SeedUploader() {
  const router = useRouter();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<SeedImportResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [pending, start] = useTransition();

  const choose = useCallback((next: File | null) => {
    setFile(next);
    // A new file invalidates the preview it wasn't made from — showing last
    // file's plan beside this file's name is how a wrong import gets applied.
    setResult(null);
    setApplied(false);
  }, []);

  function run(dryRun: boolean) {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("dryRun", dryRun ? "1" : "0");
    start(async () => {
      const next = await importSeedFile(formData);
      setResult(next);
      if (next.ok && !dryRun) {
        setApplied(true);
        router.refresh();
      }
    });
  }

  const report = result?.ok ? result.report : null;

  return (
    <div className="space-y-4">
      {/* ---------------- drop zone ---------------- */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) choose(dropped);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragOver
            ? "border-hpb-blue bg-hpb-blue/5"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600",
        )}
      >
        <Upload className="h-6 w-6 text-zinc-400" />
        <span className="text-sm font-medium">
          Drop the seed file here, or choose one
        </span>
        <span className="text-xs text-zinc-500">.csv, .tsv or .xlsx</span>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".csv,.tsv,.xlsx"
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>

      {file && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <FileSpreadsheet className="h-4 w-4 text-hpb-blue" />
          <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              choose(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Remove file"
          >
            <X className="h-4 w-4" />
          </button>
          <Button variant="outline" disabled={pending} onClick={() => run(true)}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Preview
          </Button>
          <Button
            // Apply stays behind a successful preview: the report is the only
            // place the operator sees which teams get created.
            disabled={pending || !report || applied}
            title={report ? undefined : "Preview the file first"}
            onClick={() => run(false)}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply
          </Button>
        </div>
      )}

      {result && !result.ok && (
        <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {result.error}
        </p>
      )}

      {report && <ReportView report={report} />}

      {!file && <ColumnGuide />}
    </div>
  );
}

function ReportView({ report }: { report: SeedReport }) {
  return (
    <div className="space-y-4">
      <p
        className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-sm ring-1 ring-inset",
          report.dryRun
            ? "bg-zinc-50 text-zinc-700 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
            : "bg-hpb-green/10 text-hpb-green ring-hpb-green/20",
        )}
      >
        {report.dryRun ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        {report.dryRun
          ? `Preview only — nothing was written. Applying would make ${report.writes} change${report.writes === 1 ? "" : "s"}.`
          : `Imported. ${report.writes} document${report.writes === 1 ? "" : "s"} written.`}
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Teams"
          value={`${report.teams.created} new`}
          sub={`${report.teams.matched} matched`}
        />
        <Stat
          label="Accounts"
          value={`${report.people.authCreated} new`}
          sub={`${report.people.authExisting} already existed`}
        />
        <Stat
          label="Memberships"
          value={`${report.memberships.created} added`}
          sub={`${report.memberships.existing} already in place`}
        />
        <Stat
          label="Problem rows"
          value={String(report.issues.length)}
          sub={report.issues.length === 0 ? "none" : "not imported"}
          tone={report.issues.length > 0 ? "amber" : undefined}
        />
      </div>

      {report.issues.length > 0 && (
        <Panel title="Rows that could not be imported" tone="amber">
          <ul className="space-y-1 text-sm">
            {report.issues.map((issue, i) => (
              <li key={`${issue.line}-${i}`}>
                <span className="font-medium">
                  {issue.line > 0 ? `Row ${issue.line}` : "File"}
                </span>
                {issue.label ? ` · ${issue.label}` : ""} — {issue.reason}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {report.leaderless.length > 0 && (
        <Panel title="Teams with no leader" tone="amber">
          <p className="mb-2 text-sm">
            The file&rsquo;s Role column is treated as a job title, so the
            import never promotes anyone. Promote a leader on each team&rsquo;s
            Members tab — until then only org admins can manage these teams.
          </p>
          <p className="text-sm font-medium">{report.leaderless.join(", ")}</p>
        </Panel>
      )}

      {report.notInFile.length > 0 && (
        <Panel title="On a team here, but not in the file">
          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
            The import never removes anyone. Review these and remove them by
            hand if they have left.
          </p>
          <ul className="space-y-1 text-sm">
            {report.notInFile.map((entry) => (
              <li key={entry.team}>
                <span className="font-medium">{entry.team}</span> —{" "}
                {entry.names.join(", ")}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div>
        <Eyebrow as="h2" size="md">
          Row by row
        </Eyebrow>
        <Card className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Title</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {report.rows.map((row, i) => (
                <tr key={`${row.email}-${row.team}-${i}`}>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                        row.action === "create"
                          ? "bg-hpb-green/10 text-hpb-green ring-hpb-green/20"
                          : row.action === "update"
                            ? "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20"
                            : "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
                      )}
                    >
                      {row.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 text-zinc-500">{row.email}</td>
                  <td className="px-3 py-2">{row.team}</td>
                  <td className="px-3 py-2 text-zinc-500">
                    {row.title ?? "—"}
                    {row.note ? (
                      <span className="block text-xs text-zinc-400">
                        {row.note}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.previewTruncated > 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">
              …and {report.previewTruncated} more not listed.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "amber";
}) {
  return (
    <Card className="p-3">
      <Eyebrow as="dt" className="block">
        {label}
      </Eyebrow>
      <p
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "amber" && "text-amber-700 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-zinc-500">{sub}</p>
    </Card>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "amber";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          : "border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900",
      )}
    >
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ColumnGuide() {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">What the file needs</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {SEED_FILE_COLUMNS.map((col) => (
          <div key={col.name} className="sm:flex sm:gap-3">
            <dt className="w-28 shrink-0 font-medium">
              {col.name}
              {col.required && <span className="text-red-600"> *</span>}
            </dt>
            <dd className="text-zinc-600 dark:text-zinc-400">{col.note}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        Re-importing the same file is safe: people are matched by email and
        teams by name, so a second run adds only what is new. It never removes
        anyone and never changes an existing member&rsquo;s role.
      </p>
    </Card>
  );
}
