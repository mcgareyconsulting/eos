"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { entityHeaderButtonClass } from "@/components/entity-page-header";
import { exportUrl } from "@/lib/export/urls";
import { cn } from "@/lib/utils";

/**
 * Export CSV (feedback row 55; docs/EXPORT.md). Shown to everyone on every
 * wired page: the file is exactly this view as the server shows it to the
 * person clicking, under their own permissions — the server re-checks the
 * account and the page's access rule on every request, so showing the
 * button is never the gate.
 *
 * `params` are the page's own URL state (the same keys its server component
 * reads), so the export is exactly the view on screen. One format: a POST
 * that streams back a .csv, which opens in Excel (print or save as PDF from
 * there).
 */
export function ExportControl({
  exportId,
  params,
  className,
}: {
  /** Key in lib/export/registry.ts. */
  exportId: string;
  /** Query parameters describing the view; undefined values are dropped. */
  params: Record<string, string | undefined>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(exportUrl(exportId, params), { method: "POST" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("text/csv")) {
        const body = type.includes("json")
          ? ((await res.json().catch(() => null)) as { error?: string } | null)
          : null;
        setError(body?.error ?? "The export failed. Try again.");
        return;
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        "export.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the download a moment to start before releasing the bytes.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("The export failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        className={entityHeaderButtonClass}
        disabled={busy}
        onClick={download}
        title="Download this view as a CSV (opens in Excel). Each export is recorded in the audit log."
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
        Export CSV
      </button>

      {error && (
        <p
          role="alert"
          className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
          <button
            type="button"
            className="ml-2 font-semibold underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
