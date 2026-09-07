"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type MetricInterval,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { formatGoalInput, parseScorecardValue } from "@/lib/scorecard";
import { addMetric, updateMetric } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";

const inputClass =
  "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";

type Member = { user_id: string; full_name: string };

export type MetricFormMetric = {
  id: string;
  name: string;
  unit: string;
  goal: number | null;
  direction: string;
  owner_id: string | null;
  group?: string | null;
  interval?: string | null;
};

type MetricFormModalProps =
  | {
      mode: "create";
      teamId: string;
      members: Member[];
      defaultOwnerId: string;
      groups: string[];
      /** Current Weekly/Monthly/… tab — seeds the interval field on open. */
      activePeriod: ScorecardPeriod;
    }
  | {
      mode: "edit";
      teamId: string;
      metric: MetricFormMetric;
      members: Member[];
      /**
       * The period owned by this metric's group, when it sits in one that is
       * a real group doc. Null when ungrouped, or when the label is a
       * free-text one with no doc behind it (those don't own a period, so
       * interval stays free).
       */
      groupInterval?: MetricInterval | null;
    };

/**
 * "Add measurable" / "Edit measurable" button + modal, one component for
 * both. Field-for-field the same form, minus Group on edit. Two reasons. A
 * measurable that can be created with a shape it cannot be edited back into
 * is a trap, so the two modes have to accept the same things. And Group is
 * left out of edit because `setMetricGroup` owns that field — the inline
 * group editor sits a few pixels to the left in the same bar, and two
 * controls writing one field is how the group/period rule gets forgotten on
 * one of them.
 *
 * Interval is disabled in edit mode while the measurable belongs to a
 * **defined** group: the group owns its period, and letting the two
 * disagree strands the row under neither tab. `updateMetric` enforces this
 * server-side too — the disabled field is the explanation, not the guard.
 */
export function MetricFormModal(props: MetricFormModalProps) {
  const { mode, teamId, members } = props;
  const isEdit = mode === "edit";
  const metric = isEdit ? props.metric : null;
  const groupInterval = isEdit ? props.groupInterval : null;

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(metric?.name ?? "");
  const [interval, setMetricInterval] = useState<ScorecardPeriod>(
    isEdit
      ? ((groupInterval ?? (metric?.interval as ScorecardPeriod) ?? "weekly") as ScorecardPeriod)
      : props.activePeriod,
  );
  const [unit, setUnit] = useState(metric?.unit ?? "number");
  const [direction, setDirection] = useState(metric?.direction ?? "gte");
  const [goal, setGoal] = useState(
    isEdit ? formatGoalInput(metric!.goal, metric!.unit) : "",
  );
  const [ownerId, setOwnerId] = useState(
    isEdit ? (metric!.owner_id ?? (members[0]?.user_id ?? "")) : props.defaultOwnerId,
  );
  const [group, setGroup] = useState("");

  const intervalLocked = isEdit && !!groupInterval;

  function resetForOpen() {
    if (isEdit) {
      setName(props.metric.name);
      setMetricInterval(
        (props.groupInterval ??
          (props.metric.interval as ScorecardPeriod) ??
          "weekly") as ScorecardPeriod,
      );
      setUnit(props.metric.unit);
      setDirection(props.metric.direction);
      // Seed the goal in the same notation the field accepts back, so
      // opening and saving without touching anything is a no-op rather than
      // a reformat.
      setGoal(formatGoalInput(props.metric.goal, props.metric.unit));
      setOwnerId(props.metric.owner_id ?? (props.members[0]?.user_id ?? ""));
    } else {
      setName("");
      setMetricInterval(props.activePeriod);
      setUnit("number");
      setDirection("gte");
      setGoal("");
      setOwnerId(props.defaultOwnerId);
      setGroup("");
    }
    setError(null);
  }

  function openModal() {
    resetForOpen();
    setOpen(true);
  }

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
    if (!isEdit) fd.set("group", group);

    start(async () => {
      try {
        setError(null);
        if (isEdit) {
          await updateMetric(teamId, props.metric.id, fd);
        } else {
          await addMetric(teamId, fd);
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      {isEdit ? (
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit measurable
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
        >
          <Plus className="h-4 w-4" />
          Add measurable
        </button>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={isEdit ? "Edit measurable" : "Add measurable"}
        size="lg"
      >
        <ModalHeader
          title={isEdit ? "Edit measurable" : "Add measurable"}
          onClose={() => setOpen(false)}
        />

        <ModalBody as="form" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Name
            </span>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Metric name"
              required
              autoFocus
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Interval
              </span>
              <Select
                name="interval"
                value={interval}
                disabled={intervalLocked}
                onChange={(e) =>
                  setMetricInterval(e.target.value as ScorecardPeriod)
                }
                className={intervalLocked ? "disabled:cursor-not-allowed disabled:opacity-60" : undefined}
                title={
                  intervalLocked && metric
                    ? `Set by the group "${metric.group}" — change the group to change the period`
                    : "How often this measurable is recorded"
                }
              >
                {SCORECARD_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </Select>
              {intervalLocked && (
                <span className="block text-[11px] text-zinc-500">
                  Set by the group “{metric?.group}”.
                </span>
              )}
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Unit
              </span>
              <Select
                name="unit"
                value={unit}
                onChange={(e) => changeUnit(e.target.value)}
              >
                <option value="number">Number</option>
                <option value="currency">Currency</option>
                <option value="percent">Percent</option>
                <option value="yesno">Yes/No</option>
                <option value="time">Time</option>
              </Select>
            </label>
          </div>

          {unit === "yesno" ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Goal{" "}
                <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <select
                name="goal"
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
                  name="direction"
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
            <Select
              name="owner_id"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </label>

          {isEdit ? (
            <p className="text-[11px] text-zinc-500">
              Group is edited from the row itself, next to this button.
            </p>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Group{" "}
                <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <Input
                name="group"
                list="scorecard-add-groups"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="e.g. Weekly, Compliance"
              />
              <datalist id="scorecard-add-groups">
                {props.groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <ModalFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Adding…"
                : isEdit
                  ? "Save changes"
                  : "Add metric"}
            </Button>
          </ModalFooter>
        </ModalBody>
      </ModalShell>
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
          name="goal"
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
          name="goal"
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
        name="goal"
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
      name="goal"
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Optional"
      className={inputClass}
    />
  );
}
