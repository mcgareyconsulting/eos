"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { addMetric } from "./actions";

type Member = { user_id: string; full_name: string };

/**
 * "Add measurable" button + modal. Interval defaults to the active scorecard
 * tab whenever the dialog opens (so Annual tab → Annual interval).
 */
export function AddMetricModal({
  teamId,
  members,
  defaultOwnerId,
  groups,
  activePeriod,
}: {
  teamId: string;
  members: Member[];
  defaultOwnerId: string;
  groups: string[];
  /** Current Weekly/Monthly/… tab — seeds the interval field on open. */
  activePeriod: ScorecardPeriod;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [interval, setMetricInterval] =
    useState<ScorecardPeriod>(activePeriod);
  const [unit, setUnit] = useState("number");
  const [direction, setDirection] = useState("gte");
  const [goal, setGoal] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [group, setGroup] = useState("");

  function resetForOpen() {
    setName("");
    setMetricInterval(activePeriod);
    setUnit("number");
    setDirection("gte");
    setGoal("");
    setOwnerId(defaultOwnerId);
    setGroup("");
    setError(null);
  }

  function openModal() {
    resetForOpen();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    const fd = new FormData();
    fd.set("name", name);
    fd.set("interval", interval);
    fd.set("unit", unit);
    fd.set("direction", direction);
    fd.set("goal", goal);
    fd.set("owner_id", ownerId);
    fd.set("group", group);
    start(async () => {
      try {
        setError(null);
        await addMetric(teamId, fd);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
      >
        <Plus className="h-4 w-4" />
        Add measurable
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add measurable"
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-base font-semibold tracking-tight">
                Add measurable
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={submit}
              className="flex flex-col gap-3 overflow-y-auto px-5 py-4"
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Name
                </span>
                <input
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Metric name"
                  required
                  autoFocus
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Interval
                  </span>
                  <select
                    name="interval"
                    value={interval}
                    onChange={(e) =>
                      setMetricInterval(e.target.value as ScorecardPeriod)
                    }
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    title="How often this measurable is recorded"
                  >
                    {SCORECARD_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Unit
                  </span>
                  <select
                    name="unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="percent">Percent</option>
                    <option value="yesno">Yes/No</option>
                    <option value="time">Time</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Goal comparison
                  </span>
                  <select
                    name="direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="gte">At least (&gt;=)</option>
                    <option value="lte">At most (&lt;=)</option>
                    <option value="eq">Exactly (=)</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Goal
                  </span>
                  <input
                    name="goal"
                    type="number"
                    step="any"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Owner
                </span>
                <select
                  name="owner_id"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Section{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <input
                  name="group"
                  list="scorecard-add-groups"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="e.g. Deposit volume"
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <datalist id="scorecard-add-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="mt-1 flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {pending ? "Adding…" : "Add metric"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
