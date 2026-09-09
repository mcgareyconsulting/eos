"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, Search } from "lucide-react";
import { ModalBody, ModalHeader, ModalShell } from "@/components/ui/modal";
import { Input, Select } from "@/components/ui/input";
import type { CatalogMetric } from "@/lib/firebase/scorecard-catalog";
import {
  STATUS_TONE,
  STRIP_LENGTH,
  formatValue,
  onTrack,
  trendStatus,
} from "@/lib/scorecard";
import { formatDateShort } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { addExistingMetric, listOrgMetrics } from "./actions";

const GOAL_SYMBOL: Record<string, string> = {
  gte: "\u2265",
  lte: "\u2264",
  eq: "=",
};

/**
 * 45° hatch marking an off-track period.
 *
 * **This is not decoration, it is the encoding.** Running the app's status
 * green (#2cb34a) and red (#ef4444) through a CVD check puts them ΔE 2.6 apart
 * under deuteranopia — for a red-green colourblind reader the two are the same
 * cell. Hue therefore cannot be what separates them, and in a strip this small
 * hue is otherwise the only thing that does. The hatch carries the verdict;
 * the colour reinforces it for readers who can see it.
 */
const OFF_TRACK_HATCH =
  "repeating-linear-gradient(45deg, rgba(0,0,0,0.42) 0 2px, transparent 2px 4px)";

/**
 * One period's result as a single cell.
 *
 * Three states, each separated by **shape as well as colour**: on track is a
 * full-height solid, off track is a full-height hatch, and a measurable with
 * no goal to judge against is a half-height neutral bar. A reader who sees no
 * colour at all still reads three different marks.
 *
 * Belt and braces beyond that: every cell carries a `title` and an
 * `aria-label` naming the period, value and verdict; the row carries the same
 * written status pill the scorecard grid uses; and the list carries a legend.
 */
function StripCell({
  value,
  goal,
  direction,
  unit,
  period,
}: {
  value: number;
  goal: number | null;
  direction: string;
  unit: string;
  period: string;
}) {
  const ok = onTrack(value, goal, direction as "gte" | "lte" | "eq");
  const verdict = ok === null ? "no goal set" : ok ? "on track" : "off track";
  const label = `${formatDateShort(period)} · ${formatValue(value, unit)} · ${verdict}`;
  return (
    <span
      title={label}
      aria-label={label}
      className="flex h-6 w-3.5 shrink-0 items-center"
    >
      <span
        className={cn(
          "w-full rounded-sm",
          ok === null && "h-3 bg-zinc-300 dark:bg-zinc-600",
          ok === true && "h-6 bg-hpb-green",
          ok === false && "h-6 bg-red-500",
        )}
        style={ok === false ? { backgroundImage: OFF_TRACK_HATCH } : undefined}
      />
    </span>
  );
}

/**
 * The org-wide "Add existing" picker.
 *
 * Lists **every** measurable in the organisation, not only those on teams the
 * viewer belongs to (decided 2026-09-09). Adding one puts a reference on this
 * scorecard — one measurable, one history, shown in two places — so the
 * numbers here are the owning team's numbers, live, and correcting them there
 * corrects them here.
 *
 * What the borrowing team gets is a read. Values stay editable by the owning
 * team and org admins only, and the row's remove action is **Hide**, which
 * detaches it from this scorecard and destroys nothing.
 *
 * Rows are grouped by owning team and every one is labelled with it. Without
 * that label the list is a wall of numbers whose meaning depends entirely on
 * whose they are — "Errors" tells you nothing until you know which team logs
 * it.
 */
export function AddExistingMetricModal({
  teamId,
  teamGroups,
  open,
  onOpenChange,
}: {
  teamId: string;
  /**
   * This team's custom groups — not the owning team's, which mean nothing
   * here. Named `teamGroups` to stay clear of `groups` below, which is the
   * catalog bucketed by owning team.
   */
  teamGroups: string[];
  /**
   * Always true in practice — the menu mounts this component only while the
   * picker is open, which is both why state starts fresh on every open and
   * why the modal must be a sibling of the menu's popover rather than a child
   * of it. A child would be unmounted in the same tick it was asked to open,
   * and simply never appear.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [metrics, setMetrics] = useState<CatalogMetric[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Applies to every Add in this session. One control rather than a select on
  // each row: the answer is nearly always the same for a batch, and a picker
  // per row would crowd out the trend data the list exists to show.
  const [addGroup, setAddGroup] = useState("");
  const [pending, start] = useTransition();

  // Searching overrides the collapse entirely rather than auto-expanding the
  // matches. Two reasons: a hit hidden behind a collapsed header reads as "no
  // results", and a chevron that cannot collapse anything while a query is
  // active is a control that lies. While filtering, the team names are labels;
  // when the box is cleared, they are toggles again.
  const searching = query.trim() !== "";

  // Derived, not stored. The fetch below resolves into exactly one of
  // `metrics` or `error`, so "still waiting" is the absence of both — and
  // deriving it keeps the effect free of the synchronous setState the
  // react-hooks lint rule (rightly) rejects.
  const loading = metrics === null && error === null;

  // Same trend verdict the scorecard grid computes, from the same helper, so a
  // measurable does not read "On track" here and something else once added.
  const tone = (m: CatalogMetric) =>
    STATUS_TONE[
      trendStatus(
        m.recent.map((r) => r.value),
        m.goal,
        m.direction,
      )
    ];

  // Fetched on mount — i.e. when the picker opens — not with the page. The
  // catalog is every measurable in the org and the scorecard re-renders on
  // every navigation; paying for that read to serve a modal most visits never
  // open is the wrong trade. Mounting per open also means the list is fresh,
  // so a measurable another team added since the last look shows up.
  useEffect(() => {
    let cancelled = false;
    listOrgMetrics(teamId)
      .then((rows) => {
        if (!cancelled) setMetrics(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load the measurable list. Close and try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const groups = useMemo(() => {
    if (!metrics) return [];
    const q = query.trim().toLowerCase();
    // A team's own measurables are already on the scorecard by definition, so
    // they are dropped rather than shown greyed — the picker is for finding
    // what you do *not* have.
    const rows = metrics.filter(
      (m) =>
        !m.isHome &&
        (q === "" ||
          m.name.toLowerCase().includes(q) ||
          m.teamName.toLowerCase().includes(q)),
    );
    const byTeam = new Map<string, CatalogMetric[]>();
    for (const m of rows) {
      const list = byTeam.get(m.teamName);
      if (list) list.push(m);
      else byTeam.set(m.teamName, [m]);
    }
    return [...byTeam.entries()];
  }, [metrics, query]);

  function add(metric: CatalogMetric) {
    setError(null);
    setAddingId(metric.id);
    start(async () => {
      try {
        await addExistingMetric(teamId, metric.id, addGroup);
        // Reflect it immediately so the row flips to "On scorecard" without a
        // second round trip to the catalog.
        setMetrics(
          (prev) =>
            prev?.map((m) =>
              m.id === metric.id ? { ...m, alreadyOnScorecard: true } : m,
            ) ?? prev,
        );
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't add that measurable.",
        );
      } finally {
        setAddingId(null);
      }
    });
  }

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      ariaLabel="Add an existing measurable"
      size="5xl"
    >
      <ModalHeader
        title="Add existing measurable"
        onClose={() => onOpenChange(false)}
      />

        <ModalBody>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Measurables tracked anywhere in the organisation, with their recent
            results. Adding one shows it on this scorecard with its live
            values — the owning team keeps it, and you can hide it again at any
            time.
          </p>

          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by measurable or team"
              className="pl-8"
              aria-label="Search measurables"
            />
          </label>

          {/* Where added measurables land on *this* scorecard. Left alone they
              go to the group named for their own cadence, which is always a
              true statement about them; the owning team's sections are not
              offered, since "Customer" describes their scorecard, not this
              one. */}
          <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span className="font-medium">Add to group</span>
            <Select
              value={addGroup}
              onChange={(e) => setAddGroup(e.target.value)}
              className="h-8 w-56"
            >
              <option value="">Matching cadence (Weekly, Monthly…)</option>
              {teamGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            <span className="text-zinc-400 dark:text-zinc-500">
              You can move it later from the row.
            </span>
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {/* The strip's colours mean nothing on their own, so they are named
              once here rather than relying on green/red being self-evident. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Recent periods:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-hpb-green" aria-hidden />
              On track
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-sm bg-red-500"
                style={{ backgroundImage: OFF_TRACK_HATCH }}
                aria-hidden
              />
              Off track
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-3 rounded-sm bg-zinc-300 dark:bg-zinc-600"
                aria-hidden
              />
              No goal set
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-sm border border-dashed border-zinc-300 dark:border-zinc-600"
                aria-hidden
              />
              Not recorded
            </span>

            {/* Teams start collapsed, so browsing without a search term needs
                a way in that is not eight separate clicks. Hidden while
                searching, where the collapse does not apply. */}
            {!searching && groups.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) =>
                    prev.size === groups.length
                      ? new Set()
                      : new Set(groups.map(([team]) => team)),
                  )
                }
                className="ml-auto rounded px-1.5 py-0.5 font-medium text-hpb-blue hover:bg-hpb-blue/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 dark:text-hpb-gold dark:hover:bg-hpb-gold/10"
              >
                {expanded.size === groups.length ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500">
              <span className="min-w-0 flex-1">Measurable · Owner</span>
              <span className="w-20 shrink-0 text-right">Goal</span>
              <span className="w-[4.5rem] shrink-0 text-center">Trend</span>
              <span className="w-[8.5rem] shrink-0">Recent — newest first</span>
              <span className="w-20 shrink-0 text-right">Latest</span>
              <span className="w-16 shrink-0" />
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
            {loading && (
              <p className="flex items-center gap-2 px-3 py-6 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading measurables…
              </p>
            )}

            {!loading && groups.length === 0 && (
              <p className="px-3 py-6 text-sm text-zinc-500">
                {query.trim()
                  ? "No measurables match that search."
                  : "No other team has defined a measurable yet."}
              </p>
            )}

            {!loading &&
              groups.map(([team, rows]) => {
                const isOpen = searching || expanded.has(team);
                const added = rows.filter((r) => r.alreadyOnScorecard).length;
                const summary = (
                  <>
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                      {team}
                    </span>
                    <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                      {rows.length}
                      {rows.length === 1 ? " measurable" : " measurables"}
                      {added > 0 && ` · ${added} already added`}
                    </span>
                  </>
                );
                return (
                <div key={team}>
                  {searching ? (
                    <div className="sticky top-0 z-10 flex items-center gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
                      <span className="w-3.5" aria-hidden />
                      {summary}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(team)) next.delete(team);
                          else next.add(team);
                          return next;
                        })
                      }
                      aria-expanded={isOpen}
                      className="sticky top-0 z-10 flex w-full items-center gap-2 bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hpb-blue/40 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform",
                          isOpen && "rotate-90",
                        )}
                        aria-hidden
                      />
                      {summary}
                    </button>
                  )}
                  {isOpen && (
                  <ul>
                    {rows.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-3 border-t border-zinc-100 px-3 py-2 first:border-t-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {m.name}
                          </span>
                          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {m.ownerName || "Unassigned"}
                            <span className="text-zinc-300 dark:text-zinc-600">
                              {" · "}
                            </span>
                            <span className="capitalize">{m.interval}</span>
                          </span>
                        </span>

                        {/* Goal, in text tokens rather than a status colour —
                            it is a target, not a verdict. */}
                        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {m.goal === null
                            ? "no goal"
                            : `${GOAL_SYMBOL[m.direction] ?? ""} ${formatValue(m.goal, m.unit)}`}
                        </span>

                        {/* Written verdict beside the coloured strip, using the
                            same pill the scorecard grid uses — so a row reads
                            the same here as it does once added. */}
                        <span
                          className={cn(
                            "w-[4.5rem] shrink-0 rounded-full px-1.5 py-px text-center text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset",
                            tone(m).pill,
                          )}
                        >
                          {tone(m).label}
                        </span>

                        {/* Newest on the left, matching the scorecard grid's
                            own column order — the same row should not read
                            backwards in two places. */}
                        <span
                          className="flex shrink-0 items-center gap-0.5"
                          role="img"
                          aria-label={`Last ${m.recent.length} recorded periods, newest first`}
                        >
                          {m.recent.map((r) => (
                            <StripCell
                              key={r.period}
                              value={r.value}
                              goal={m.goal}
                              direction={m.direction}
                              unit={m.unit}
                              period={r.period}
                            />
                          ))}
                          {/* Placeholders keep every strip the same width so
                              the column of latest values stays aligned. */}
                          {Array.from({
                            length: Math.max(0, STRIP_LENGTH - m.recent.length),
                          }).map((_, i) => (
                            <span
                              key={`pad-${i}`}
                              className="h-6 w-3.5 shrink-0 rounded-sm border border-dashed border-zinc-200 dark:border-zinc-700"
                            />
                          ))}
                        </span>

                        <span className="w-20 shrink-0 text-right text-sm tabular-nums text-zinc-900 dark:text-zinc-100">
                          {m.recent[0]
                            ? formatValue(m.recent[0].value, m.unit)
                            : "—"}
                        </span>

                        {m.alreadyOnScorecard ? (
                          <span className="inline-flex w-16 shrink-0 items-center justify-end gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            Added
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => add(m)}
                            disabled={pending && addingId === m.id}
                            className="w-16 shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          >
                            {pending && addingId === m.id ? "Adding…" : "Add"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  )}
                </div>
                );
              })}
            </div>
          </div>
      </ModalBody>
    </ModalShell>
  );
}
