"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { entityHeaderButtonClass } from "@/components/entity-page-header";
import { exportUrls } from "@/lib/export/urls";
import { cn } from "@/lib/utils";

/**
 * Admin-only Export menu (feedback row 55; docs/EXPORT.md). Render it only
 * for admins — but the server re-checks on every request, so hiding it is a
 * convenience, not the gate.
 *
 * `params` are the page's own URL state (the same keys its server component
 * reads), so the export is exactly the view on screen. Both formats go
 * through the shared core: the spreadsheet is a POST that streams the file
 * back; the print view opens in a new tab for Print → Save as PDF.
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const urls = exportUrls(exportId, params);

  async function downloadXlsx() {
    setOpen(false);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(urls.xlsx, { method: "POST" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("spreadsheetml")) {
        const body = type.includes("json")
          ? ((await res.json().catch(() => null)) as { error?: string } | null)
          : null;
        setError(body?.error ?? "The export failed. Try again.");
        return;
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        "export.xlsx";
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

  function openPrint() {
    setOpen(false);
    setError(null);
    window.open(urls.print, "_blank", "noopener");
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        className={entityHeaderButtonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title="Admin: export this view"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
        Export
        <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <button
            type="button"
            role="menuitem"
            onClick={downloadXlsx}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <FileSpreadsheet className="h-4 w-4 text-hpb-green" aria-hidden />
            Spreadsheet (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={openPrint}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Printer className="h-4 w-4 text-hpb-blue dark:text-sky-400" aria-hidden />
            Print / Save as PDF
          </button>
          <p className="border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Exactly this view. Each export is recorded in the audit log.
          </p>
        </div>
      )}

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
