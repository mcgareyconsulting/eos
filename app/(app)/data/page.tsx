import Link from "next/link";
import { Database, Download, Upload } from "lucide-react";
import { getImportableTeams, requireOrgReader } from "@/lib/firebase/teams";
import { EmptyState } from "@/components/empty-state";
import { loadData, type DataFilters as Filters } from "@/lib/data-directory/load";
import {
  DATA_TYPES,
  isDataTypeKey,
  isoDay,
  type DataState,
} from "@/lib/data-directory/registry";
import { DataFilters } from "./data-filters";

// The table renders at most this many rows; the count strip always reports the
// real totals, and CSV export is uncapped. Silently truncating a data page is
// how someone concludes a row doesn't exist.
const ROW_CAP = 500;

const STATES = new Set<string>(["active", "done", "archived", "cancelled"]);

function qs(params: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    team?: string;
    owner?: string;
    state?: string;
    quarter?: string;
    q?: string;
  }>;
}) {
  const { db } = await requireOrgReader();
  const sp = await searchParams;

  const typeParam = sp.type && isDataTypeKey(sp.type) ? sp.type : "all";
  // Quarter only exists on rocks, so the facet is offered only where it can
  // mean something — otherwise picking one would empty the table.
  const quarterApplies = typeParam === "all" || typeParam === "rocks";
  const filters: Filters = {
    type: typeParam,
    teamId: sp.team || null,
    ownerId: sp.owner || null,
    state: sp.state && STATES.has(sp.state) ? (sp.state as DataState) : null,
    quarter: quarterApplies ? sp.quarter || null : null,
    q: sp.q || null,
  };

  const [data, importableTeams] = await Promise.all([
    loadData(db, filters),
    getImportableTeams(),
  ]);

  const single = typeParam === "all" ? null : data.byType[0];
  const total = data.rows.length;
  const shown = Math.min(total, ROW_CAP);
  const exportHref = single
    ? `/api/data/export${qs({
        type: typeParam,
        team: sp.team ?? "",
        owner: sp.owner ?? "",
        state: filters.state ?? "",
        quarter: filters.quarter ?? "",
        q: sp.q ?? "",
      })}`
    : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-hpb-blue dark:text-hpb-gold">
            <Database className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Org data
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Data
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Every record the app holds, across all teams and all owners. Read
            only — edit a row on its own team page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {exportHref && (
            <a
              href={exportHref}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          )}
          {importableTeams.length > 0 && (
            <Link
              href="/data/import"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-hpb-blue px-3 text-sm font-medium text-white hover:opacity-90"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Link>
          )}
        </div>
      </header>

      <DataFilters
        types={DATA_TYPES.map((t) => ({ key: t.key, label: t.label }))}
        teams={data.teams}
        owners={data.owners}
        quarters={data.quarters}
        showQuarter={quarterApplies}
        current={{
          type: typeParam === "all" ? "" : typeParam,
          team: sp.team ?? "",
          owner: sp.owner ?? "",
          state: filters.state ?? "",
          quarter: filters.quarter ?? "",
          q: sp.q ?? "",
        }}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {total.toLocaleString()} {total === 1 ? "record" : "records"}
        </span>
        {data.byType
          .filter((t) => t.entries.length > 0)
          .map((t) => (
            <span key={t.def.key}>
              {t.def.label} {t.entries.length.toLocaleString()}
            </span>
          ))}
      </div>

      {/* Two schema facts that make raw counts read wrong if unstated. */}
      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
        Rows imported before <code>archived_at</code> existed carry no archive
        field and count as Active. Legacy issues may use <code>archived</code>{" "}
        instead — both are read as Archived here.
      </p>

      {total === 0 ? (
        <EmptyState
          title="Nothing matches"
          hint="No records match these filters. Reset to see everything."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  {single ? (
                    single.def.columns.map((c) => (
                      <th key={c.header} className="px-3 py-2 font-medium">
                        {c.header}
                      </th>
                    ))
                  ) : (
                    <>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Title</th>
                      <th className="px-3 py-2 font-medium">Team</th>
                      <th className="px-3 py-2 font-medium">Owner</th>
                      <th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 font-medium">Detail</th>
                      <th className="px-3 py-2 font-medium">Date (UTC)</th>
                    </>
                  )}
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {single
                  ? single.entries.slice(0, ROW_CAP).map(({ doc, row }) => (
                      <tr
                        key={row.id}
                        className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        {single.def.columns.map((c) => (
                          <td
                            key={c.header}
                            className="px-3 py-2 text-zinc-800 dark:text-zinc-200"
                          >
                            {c.get(doc, data.ctx) || "—"}
                          </td>
                        ))}
                        <OpenCell href={row.href} />
                      </tr>
                    ))
                  : data.rows.slice(0, ROW_CAP).map((row) => (
                      <tr
                        key={`${row.type}:${row.id}`}
                        className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {row.typeLabel}
                        </td>
                        <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                          {row.title || "—"}
                        </td>
                        <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                          {data.ctx.teamName(row.teamId)}
                        </td>
                        <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                          {row.owner}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {row.state}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {row.detail || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                          {isoDay(row.updated) || "—"}
                        </td>
                        <OpenCell href={row.href} />
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {total > shown && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Showing {shown.toLocaleString()} of {total.toLocaleString()}.
              Narrow the filters, or export the CSV for the full set.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function OpenCell({ href }: { href: string | null }) {
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right">
      {href ? (
        <Link
          href={href}
          className="text-hpb-blue underline underline-offset-2 dark:text-hpb-gold"
        >
          Open
        </Link>
      ) : null}
    </td>
  );
}
