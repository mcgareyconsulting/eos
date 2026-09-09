"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Layers, Trash2 } from "lucide-react";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { defaultGroupName, type ScorecardGroup } from "@/lib/scorecard-groups";
import {
  addScorecardGroup,
  deleteScorecardGroup,
  moveScorecardGroup,
} from "./actions";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { entityHeaderButtonClass } from "@/components/entity-page-header";
import { ModalShell, ModalHeader } from "@/components/ui/modal";

/**
 * "Groups" button + modal: create a group, and set the order groups appear in
 * within their period.
 *
 * Order is the whole reason this exists. A group used to be a free-text label
 * sorted alphabetically, which put Compliance above Weekly — backwards,
 * because Compliance is a weekly group that shouldn't outrank the ordinary
 * weekly measurables. Position is chosen here instead of inferred.
 */
export function ManageGroupsButton({
  teamId,
  groups,
  activePeriod = "weekly",
}: {
  teamId: string;
  groups: ScorecardGroup[];
  activePeriod?: ScorecardPeriod;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [interval, setInterval] = useState<ScorecardPeriod>(activePeriod);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name required");
      return;
    }
    const fd = new FormData();
    fd.set("name", trimmed);
    fd.set("interval", interval);
    start(async () => {
      try {
        setError(null);
        await addScorecardGroup(teamId, fd);
        setName("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function move(groupId: string, direction: -1 | 1) {
    start(async () => {
      try {
        setError(null);
        await moveScorecardGroup(teamId, groupId, direction);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function remove(groupId: string) {
    start(async () => {
      try {
        setError(null);
        await deleteScorecardGroup(teamId, groupId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // One list per period, because position only means anything inside one.
  //
  // Every period is listed now, even one with no custom groups, because every
  // period always has at least its default group — and a modal that showed
  // nothing for Weekly while the scorecard rendered a "Weekly" header was
  // describing a different app than the one on screen.
  const byPeriod = SCORECARD_PERIODS.map((p) => ({
    period: p,
    items: groups.filter((g) => g.interval === p),
  }));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setInterval(activePeriod);
          setError(null);
          setOpen(true);
        }}
        className={entityHeaderButtonClass}
      >
        <Layers className="h-4 w-4" aria-hidden />
        Groups
      </button>

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Scorecard groups"
        size="lg"
        portal
      >
        <ModalHeader title="Scorecard groups" onClose={() => setOpen(false)} />

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <form onSubmit={submit} className="flex flex-wrap gap-2">
            {/* The shared field components rather than hand-rolled copies of
                their classes — which is how this row ended up with 34px
                controls beside a 32px Add button. */}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name (e.g. Compliance)"
              className="min-w-0 flex-1"
            />
            <Select
              value={interval}
              onChange={(e) =>
                setInterval(e.target.value as ScorecardPeriod)
              }
              aria-label="Period"
              className="w-auto"
            >
              {SCORECARD_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={pending}>
              Add
            </Button>
          </form>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {byPeriod.map(({ period, items }) => (
              <section key={period} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {PERIOD_LABELS[period]}
                </h3>
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {/* The default group. Not a `scorecard_groups` doc — it is
                      where every measurable with no group of its own renders —
                      so it has no position to change and nothing to delete,
                      and its controls are omitted rather than shown disabled.
                      It is listed because it is a real header on the
                      scorecard, and leaving it out made this list look like
                      the complete set of sections when it was not. */}
                  <li className="flex items-center gap-2 bg-zinc-50/60 px-3 py-2 text-sm dark:bg-zinc-800/30">
                    <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                      {defaultGroupName(period)}
                    </span>
                    <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      Default
                    </span>
                  </li>
                  {items.map((g, i) => (
                    <li
                      key={g.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {g.name}
                      </span>
                      <IconButton
                        muted
                        onClick={() => move(g.id, -1)}
                        disabled={pending || i === 0}
                        aria-label={`Move ${g.name} up`}
                        title="Move up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        muted
                        onClick={() => move(g.id, 1)}
                        disabled={pending || i === items.length - 1}
                        aria-label={`Move ${g.name} down`}
                        title="Move down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </IconButton>
                      <button
                        type="button"
                        onClick={() => remove(g.id)}
                        disabled={pending}
                        aria-label={`Delete ${g.name}`}
                        title="Delete group — its measurables stay and return to the default group"
                        className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:text-zinc-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Every measurable is in a group. Ones you haven&rsquo;t filed sit in
            the default group for their cadence, which always shows first;
            your own groups follow in this order. Deleting a group keeps its
            measurables and returns them to the default.
          </p>
        </div>
      </ModalShell>
    </>
  );
}
