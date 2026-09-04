"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type MetricInterval,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { formatGoalInput, parseScorecardValue } from "@/lib/scorecard";
import { updateMetric } from "./actions";

const inputClass =
  "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";

type Member = { user_id: string; full_name: string };

/**
 * "Edit measurable" button + modal, opened from a row's expand panel.
 *
 * Deliberately the same form as `AddMetricModal` field-for-field, minus Group.
 * Two reasons. A measurable that can be created with a shape it cannot be
 * edited back into is a trap, so the two forms have to accept the same things.
 * And Group is left out because `setMetricGroup` owns that field — the inline
 * group editor sits a few pixels to the left in the same bar, and two controls
 * writing one field is how the group/period rule gets forgotten on one of them.
 *
 * Interval is disabled while the measurable belongs to a **defined** group: the
 * group owns its period, and letting the two disagree strands the row under
 * neither tab. `updateMetric` enforces this server-side too — the disabled
 * field is the explanation, not the guard.
 */
export function EditMetricModal({
  teamId,
  metric,
  members,
  groupInterval,
}: {
  teamId: string;
  metric: {
    id: string;
    name: string;
    unit: string;
    goal: number | null;
    direction: string;
    owner_id: string | null;
    group?: string | null;
    interval?: string | null;
  };
  members: Member[];
  /**
   * The period owned by this metric's group, when it sits in one that is a
   * real group doc. Null when ungrouped, or when the label is a free-text one
   * with no doc behind it (those don't own a period, so interval stays free).
   */
  groupInterval?: MetricInterval | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(metric.name);
  const [interval, setMetricInterval] = useState<ScorecardPeriod>(
    (metric.interval as ScorecardPeriod) ?? "weekly",
  );
  const [unit, setUnit] = useState(metric.unit);
  const [direction, setDirection] = useState(metric.direction);
  const [goal, setGoal] = useState("");

  const [ownerId, setOwnerId] = useState(metric.owner_id ?? "");

  const intervalLocked = !!groupInterval;

  function resetForOpen() {
    setName(metric.name);
    setMetricInterval(
      (groupInterval ?? (metric.interval as ScorecardPeriod) ?? "weekly") as ScorecardPeriod,
    );
    setUnit(metric.unit);
    setDirection(metric.direction);
    // Seed the goal in the same notation the field accepts back, so opening
    // and saving without touching anything is a no-op rather than a reformat.
    setGoal(formatGoalInput(metric.goal, metric.unit));
    setOwnerId(metric.owner_id ?? (members[0]?.user_id ?? ""));
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

  function changeUnit(next: string) {
    setUnit(next);
    // Changing the unit invalidates the goal's notation ("Yes" is not a
    // number, 1:30 is not a percent), so clear rather than carry it across.
    if (next === "yesno") {
      setDirection("eq");
      setGoal("");
    } else if (unit === "yesno" || unit === "time" || next === "time") {
      setGoal("");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    if (goal.trim()) {
      const parsed = parseScorecardValue(goal, unit);
      if (!parsed.ok) {
        setError(
          unit === "yesno"
            ? "Goal must be Yes or No"
            : unit === "time"
              ? "Goal must be a time (h:mm)"
              : "Goal must be a number",
        );
        return;
      }
    }
    const fd = new FormData();
    fd.set("name", name);
    fd.set("interval", interval);
    fd.set("unit", unit);
    fd.set("direction", unit === "yesno" ? "eq" : direction);
    fd.set("goal", goal);
    fd.set("owner_id", ownerId);
    start(async () => {
      try {
        setError(null);
        await updateMetric(teamId, metric.id, fd);
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
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Edit measurable
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
            aria-label="Edit measurable"
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-base font-semibold tracking-tight">
                Edit measurable
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
                    value={interval}
                    disabled={intervalLocked}
                    onChange={(e) =>
                      setMetricInterval(e.target.value as ScorecardPeriod)
                    }
                    className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                    title={
                      intervalLocked
                        ? `Set by the group "${metric.group}" — change the group to change the period`
                        : "How often this measurable is recorded"
                    }
                  >
                    {SCORECARD_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABELS[p]}
                      </option>
                    ))}
                  </select>
                  {intervalLocked && (
                    <span className="block text-[11px] text-zinc-500">
                      Set by the group “{metric.group}”.
                    </span>
                  )}
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Unit
                  </span>
                  <select
                    value={unit}
                    onChange={(e) => changeUnit(e.target.value)}
                    className={inputClass}
                  >
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="percent">Percent</option>
                    <option value="yesno">Yes/No</option>
                    <option value="time">Time</option>
                  </select>
                </label>
              </div>

              {unit === "yesno" ? (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Goal{" "}
                    <span className="font-normal text-zinc-400">(optional)</span>
                  </span>
                  <select
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">No goal</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </label>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Goal comparison
                    </span>
                    <select
                      value={direction}
                      onChange={(e) => setDirection(e.target.value)}
                      className={inputClass}
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
                    <GoalInput unit={unit} value={goal} onChange={setGoal} />
                  </label>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Owner
                </span>
                <select
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

              <p className="text-[11px] text-zinc-500">
                Group is edited from the row itself, next to this button.
              </p>

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
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function GoalInput({
  unit,
  value,
  onChange,
}: {
  unit: string;
  value: string;
  onChange: (next: string) => void;
}) {
  if (unit === "currency") {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Optional"
          className={`${inputClass} pl-6`}
        />
      </div>
    );
  }

  if (unit === "percent") {
    return (
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Optional"
          className={`${inputClass} pr-7`}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
          %
        </span>
      </div>
    );
  }

  if (unit === "time") {
    return (
      <input
        type="text"
        inputMode="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 1:30"
        className={inputClass}
      />
    );
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Optional"
      className={inputClass}
    />
  );
}
