"use client";

import { ChevronDown } from "lucide-react";
import { DATA_STATES, UNOWNED_FILTER_VALUE, UNOWNED_LABEL } from "@/lib/data-directory/registry";

/**
 * The /data facet bar.
 *
 * A plain GET form rather than router.push-per-control: every facet is a named
 * field, so the browser rebuilds the whole query string on submit and no
 * control has to remember the others. Selects submit on change; the search box
 * submits on Enter.
 */
export function DataFilters({
  types,
  teams,
  owners,
  quarters,
  current,
  showQuarter,
}: {
  types: { key: string; label: string }[];
  teams: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  quarters: string[];
  current: {
    type: string;
    team: string;
    owner: string;
    state: string;
    quarter: string;
    q: string;
  };
  showQuarter: boolean;
}) {
  return (
    <form
      action="/data"
      className="flex flex-wrap items-end gap-2"
      // Empty selects still submit as `?team=`; strip them so the URL stays
      // readable and a bookmarked filter means what it says.
      onSubmit={(e) => {
        for (const el of Array.from(e.currentTarget.elements)) {
          const field = el as HTMLInputElement | HTMLSelectElement;
          if (field.name && field.value === "") field.disabled = true;
        }
      }}
    >
      <Facet label="Type" name="type" value={current.type}>
        <option value="">All types</option>
        {types.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </Facet>

      <Facet label="Team" name="team" value={current.team}>
        <option value="">All teams</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Facet>

      <Facet label="Owner" name="owner" value={current.owner}>
        <option value="">All owners</option>
        <option value={UNOWNED_FILTER_VALUE}>{UNOWNED_LABEL}</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Facet>

      <Facet label="State" name="state" value={current.state}>
        <option value="">All states</option>
        {DATA_STATES.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </Facet>

      {showQuarter && (
        <Facet label="Quarter" name="quarter" value={current.quarter}>
          <option value="">All quarters</option>
          {quarters.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </Facet>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Search
        </span>
        <input
          type="search"
          name="q"
          defaultValue={current.q}
          placeholder="Title, owner, team, id…"
          className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>

      <button
        type="submit"
        className="h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        Apply
      </button>
      <a
        href="/data"
        className="h-8 rounded-md px-3 text-sm leading-8 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        Reset
      </a>
    </form>
  );
}

function Facet({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="relative">
        <select
          name={name}
          defaultValue={value}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-8 appearance-none rounded-md border border-zinc-300 bg-white py-0 pl-2.5 pr-7 text-sm font-medium text-zinc-800 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
      </div>
    </label>
  );
}
