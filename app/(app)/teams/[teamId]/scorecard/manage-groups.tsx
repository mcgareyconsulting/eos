"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Layers, Trash2 } from "lucide-react";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import type { ScorecardGroup } from "@/lib/scorecard-groups";
import {
  addScorecardGroup,
  deleteScorecardGroup,
  moveScorecardGroup,
} from "./actions";
import { Button, IconButton } from "@/components/ui/button";
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
  const byPeriod = SCORECARD_PERIODS.map((p) => ({
    period: p,
    items: groups.filter((g) => g.interval === p),
  })).filter((row) => row.items.length > 0);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setInterval(activePeriod);
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5"
      >
        <Layers className="h-4 w-4" aria-hidden />
        Groups
      </Button>

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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name (e.g. Compliance)"
              className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <select
              value={interval}
              onChange={(e) =>
                setInterval(e.target.value as ScorecardPeriod)
              }
              aria-label="Period"
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {SCORECARD_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending}>
              Add
            </Button>
          </form>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {byPeriod.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No groups yet. Measurables without one sit at the top of
              the scorecard; groups collect the rest underneath.
            </p>
          ) : (
            byPeriod.map(({ period, items }) => (
              <section key={period} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {PERIOD_LABELS[period]}
                </h3>
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
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
                        title="Delete group — its measurables stay, ungrouped"
                        className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:text-zinc-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Measurables with no group show first, then each group in this
            order. Deleting a group keeps its measurables and leaves them
            ungrouped.
          </p>
        </div>
      </ModalShell>
    </>
  );
}
