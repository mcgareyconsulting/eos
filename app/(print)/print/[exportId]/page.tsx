import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PrintSheet } from "@/components/export/print-sheet";
import { runExport } from "@/lib/export/run";

export const metadata: Metadata = {
  title: "Export — HPB Pulse",
  robots: { index: false, follow: false },
};

/**
 * Admin export, print view (feedback row 55; docs/EXPORT.md). The PDF format:
 * this page, then the browser's Print → Save as PDF.
 *
 *   /print/{exportId}?<the page's own query parameters>
 *
 * Outside the (app) group on purpose — no sidebar or header on paper. Every
 * guardrail (admin re-check, exact view, provenance, audit row, row cap) is
 * lib/export/run.ts, the same core the .xlsx route uses; rendering this page
 * IS the export, so it writes the audit row (format "print").
 */
export default async function PrintExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ exportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { exportId } = await params;
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    // First value wins, as `searchParams.get` does on the .xlsx route.
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string") query.set(key, v);
  }

  const result = await runExport(exportId, query, "print");
  if (!result.ok) {
    if (result.status === 401) redirect("/login");
    // Non-admins and unknown pages: the 404 every admin-only surface gives
    // (lib/firebase/teams.ts requireAdmin), so ids aren't enumerable.
    if (result.status === 403 || result.status === 404) notFound();
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Export not produced</h1>
        <p role="alert" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {result.message}
        </p>
      </div>
    );
  }
  return <PrintSheet table={result.table} />;
}
