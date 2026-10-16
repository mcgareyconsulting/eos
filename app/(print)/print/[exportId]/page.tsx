import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PrintSheet } from "@/components/export/print-sheet";
import { isCrossSiteNavigation, printPageAction } from "@/lib/export/response";
import { runPrintExport } from "@/lib/export/run";

export const metadata: Metadata = {
  title: "Export — HPB Pulse",
  robots: { index: false, follow: false },
  // The URL carries a (spent) token; keep it out of any Referer.
  referrer: "no-referrer",
};

/**
 * Admin export, print view (feedback row 55; docs/EXPORT.md). The PDF format:
 * this page, then the browser's Print → Save as PDF.
 *
 *   /print/{exportId}?t=<single-use token>
 *
 * The token comes from POST /api/export/{exportId}/print-token, which the
 * Export control calls (same-origin only); it is bound to the admin, the
 * export and the view, lives two minutes and works once
 * (lib/export/print-token.ts). The view comes from the token, never from
 * this URL — so a cross-site link, which can't mint one, can't make this
 * page export or audit anything. A Sec-Fetch-Site check backs that up.
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
  const raw = (await searchParams).t;
  // First value wins, as `searchParams.get` does.
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? null;
  const crossSite = isCrossSiteNavigation(await headers());

  const action = printPageAction(await runPrintExport(exportId, token, { crossSite }));
  if (action.kind === "login") redirect("/login");
  // Non-admins and unknown pages (lib/export/response.ts printPageAction).
  if (action.kind === "not_found") notFound();
  if (action.kind === "message") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Export not produced</h1>
        <p role="alert" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {action.message}
        </p>
      </div>
    );
  }
  return <PrintSheet table={action.table} />;
}
