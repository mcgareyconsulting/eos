import type { ExportTable } from "@/lib/export/types";
import { PrintButton } from "./print-button";

/**
 * The print-optimized view of an export (docs/EXPORT.md) — the PDF format is
 * this page plus the browser's own Print → Save as PDF, so no headless
 * browser runs on the server.
 *
 * Always light, whatever the app theme: it is paper. The provenance block
 * heads the first page; the table header repeats on every printed page (a
 * `<thead>` does that natively) and rows never split across a page break.
 * The toolbar is screen-only.
 */
export function PrintSheet({ table }: { table: ExportTable }) {
  return (
    <div className="min-h-screen bg-white px-6 py-6 text-zinc-900 print:min-h-0 print:p-0">
      <div className="mb-5 flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-zinc-600">
          Use <strong>Print</strong>, then choose <strong>Save as PDF</strong> as the
          destination. Landscape fits more columns.
        </p>
        <PrintButton />
      </div>

      <header className="mb-4 border-b border-zinc-300 pb-3">
        <h1 className="text-lg font-bold">{table.provenance[0]?.value ?? table.title}</h1>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-xs">
          {table.provenance.slice(1).map((line) => (
            <div key={line.label} className="contents">
              <dt className="font-semibold text-zinc-600">{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {table.rows.length === 0 ? (
        <p className="text-sm text-zinc-600">No rows in this view.</p>
      ) : (
        <table className="w-full border-collapse text-[11px] leading-snug">
          <thead>
            <tr>
              {table.headers.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="border-b-2 border-zinc-400 px-1.5 py-1 text-left align-bottom font-bold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="break-inside-avoid odd:bg-zinc-50 print:odd:bg-transparent">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`border-b border-zinc-200 px-1.5 py-1 align-top whitespace-pre-wrap ${
                      typeof cell === "number" ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
