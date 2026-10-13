"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import type { MetricInterval, ScorecardPeriod } from "@/lib/scorecard-periods";
import { formatGoalInput, parseScorecardValue } from "@/lib/scorecard";
import { addMetric, setMetricPublic, updateMetric } from "./actions";
import {
  DIRECTION_OPTIONS,
  PERIOD_OPTIONS,
  UNIT_OPTIONS,
  YESNO_GOAL_OPTIONS,
  metricOwnerLabel,
} from "./metric-form-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox, SelectMenu } from "@/components/ui/select-menu";
import { OwnerPicker } from "@/components/ui/owner-picker";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalShell,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDiscardGuard,
} from "@/components/ui/modal";

// 32px like the SelectMenu triggers beside it on the goal row.
const inputClass =
  "h-8 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";

const labelTextClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

/** The Owner picker never opens its "Whole org" tab (`teamOnly`), so these
 *  are never read; they only satisfy its props. */
const NO_ORG_TEAM_NAMES: ReadonlyMap<string, string> = new Map();
const noop = () => {};

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
  is_public?: boolean | null;
  /** Server-resolved owner name, for an owner no longer on the roster. */
  ownerName?: string | null;
};

/**
 * Optional controlled mode, used by the Add-measurable menu.
 *
 * Passing `open` suppresses the built-in trigger button and hands the parent
 * the state, so the modal can be mounted somewhere the menu is not — which it
 * has to be, because the menu unmounts itself when an item is chosen and a
 * modal rendered inside it would be destroyed in the same tick it was asked to
 * open. That was a real bug, not a hypothetical.
 *
 * A controlled caller is expected to **mount this component only while the
 * modal is open**. That is what replaces `resetForOpen()` on that path: fresh
 * `useState` initialisers seed the form from props on every open, so nothing
 * carries over from the last one, and no effect has to reach in and reset
 * state after the fact.
 */
type ControlledProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type MetricFormModalProps = ControlledProps &
  ({
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
    });

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
  // Controlled when the caller passes `open`; self-managed otherwise, which is
  // what every existing call site (the Edit button in the expand panel) does.
  const controlled = props.open !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? !!props.open : selfOpen;
  const setOpen = (next: boolean) => {
    if (controlled) props.onOpenChange?.(next);
    else setSelfOpen(next);
  };
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
    isEdit ? (metric!.owner_id ?? "") : props.defaultOwnerId,
  );
  const [group, setGroup] = useState("");
  const [isPublic, setIsPublic] = useState(metric?.is_public === true);
  // What the fields held when the modal opened. Seeded from the state hooks
  // above on first render, which covers the controlled path too — a
  // controlled caller mounts this component only while the modal is open (see
  // the note above ControlledProps), so mount time is open time there.
  const [opened, setOpened] = useState(() => ({
    name,
    interval,
    unit,
    direction,
    goal,
    ownerId,
    group,
    isPublic,
  }));

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(
    draftChanged(
      { name, interval, unit, direction, goal, ownerId, group, isPublic },
      opened,
    ),
    () => setOpen(false),
  );

  const intervalLocked = isEdit && !!groupInterval;

  function resetForOpen() {
    if (props.mode === "edit") {
      hydrate({
        name: props.metric.name,
        interval: (props.groupInterval ??
          (props.metric.interval as ScorecardPeriod) ??
          "weekly") as ScorecardPeriod,
        unit: props.metric.unit,
        direction: props.metric.direction,
        // Seed the goal in the same notation the field accepts back, so
        // opening and saving without touching anything is a no-op rather than
        // a reformat.
        goal: formatGoalInput(props.metric.goal, props.metric.unit),
        ownerId: props.metric.owner_id ?? "",
        // Create-only field; never rendered or submitted on edit.
        group: "",
        isPublic: props.metric.is_public === true,
      });
    } else {
      hydrate({
        name: "",
        interval: props.activePeriod,
        unit: "number",
        direction: "gte",
        goal: "",
        ownerId: props.defaultOwnerId,
        group: "",
        isPublic: false,
      });
    }
  }

  /** Sets every field and records them as the values the form opened with. */
  function hydrate(draft: {
    name: string;
    interval: ScorecardPeriod;
    unit: string;
    direction: string;
    goal: string;
    ownerId: string;
    group: string;
    isPublic: boolean;
  }) {
    setName(draft.name);
    setMetricInterval(draft.interval);
    setUnit(draft.unit);
    setDirection(draft.direction);
    setGoal(draft.goal);
    setOwnerId(draft.ownerId);
    setGroup(draft.group);
    setIsPublic(draft.isPublic);
    setOpened(draft);
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
    // The native Owner select was `required`; the picker can't be, so the
    // same block lives here (updateMetric refuses an empty owner too).
    if (!ownerId) {
      setError("Choose an owner.");
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
    if (!isEdit) {
      fd.set("group", group);
      fd.set("is_public", isPublic ? "true" : "false");
    }

    start(async () => {
      try {
        setError(null);
        if (isEdit) {
          await updateMetric(teamId, props.metric.id, fd);
          if (isPublic !== (props.metric.is_public === true)) {
            await setMetricPublic(teamId, props.metric.id, isPublic);
          }
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
      {controlled ? null : isEdit ? (
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
        onClose={guard.requestClose}
        // Escape belongs to the discard confirm while it is up.
        dismissible={!guard.asking}
        ariaLabel={isEdit ? "Edit measurable" : "Add measurable"}
        size="3xl"
      >
        <ModalHeader
          title={isEdit ? "Edit measurable" : "Add measurable"}
          onClose={guard.requestClose}
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

          {/* What is measured and against what, on one row at this width:
              Interval · Unit · Comparison · Goal. Yes/No has no comparison
              (always "eq"), so its goal takes both of those columns. Two
              columns below `sm`. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block space-y-1">
              <span className={labelTextClass}>Interval</span>
              <SelectMenu
                name="interval"
                options={PERIOD_OPTIONS}
                value={interval}
                disabled={intervalLocked}
                onChange={setMetricInterval}
                title={
                  intervalLocked && metric
                    ? `Set by the group "${metric.group}" — change the group to change the period`
                    : "How often this measurable is recorded"
                }
              />
              {intervalLocked && (
                <span className="block text-[11px] text-zinc-500">
                  Set by the group “{metric?.group}”.
                </span>
              )}
            </label>

            <label className="block space-y-1">
              <span className={labelTextClass}>Unit</span>
              <SelectMenu
                name="unit"
                options={UNIT_OPTIONS}
                value={unit}
                onChange={changeUnit}
              />
            </label>

            {unit === "yesno" ? (
              <label className="col-span-2 block space-y-1">
                <span className={labelTextClass}>
                  Goal{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <SelectMenu
                  name="goal"
                  options={YESNO_GOAL_OPTIONS}
                  value={goal}
                  onChange={setGoal}
                />
              </label>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className={labelTextClass}>Goal comparison</span>
                  <SelectMenu
                    name="direction"
                    options={DIRECTION_OPTIONS}
                    value={direction}
                    onChange={setDirection}
                  />
                </label>

                <label className="block space-y-1">
                  <span className={labelTextClass}>Goal</span>
                  <GoalInput unit={unit} value={goal} onChange={setGoal} />
                </label>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Team roster only (`teamOnly`): addMetric / updateMetric require
                the owner on this team (requireRosterOwner), so the picker's
                "Whole org" tab would only offer saves the server refuses.
                Not a <label> wrapper — the picker names itself ("Owner: …"). */}
            <div className="space-y-1">
              <span className={`block ${labelTextClass}`} aria-hidden>
                Owner
              </span>
              <OwnerPicker
                variant="field"
                label="Owner"
                name="owner_id"
                value={ownerId}
                valueName={metricOwnerLabel({
                  ownerId,
                  members,
                  selfId: isEdit ? undefined : props.defaultOwnerId,
                  resolvedName: metric?.ownerName,
                })}
                onChange={setOwnerId}
                team={{ id: teamId, name: "This team", people: members }}
                teamOnly
                orgPeople={null}
                onNeedOrg={noop}
                teamNameById={NO_ORG_TEAM_NAMES}
              />
            </div>

            {isEdit ? (
              <p className="self-end pb-2 text-[11px] text-zinc-500">
                Group is edited from the row itself, next to this button.
              </p>
            ) : (
              <label className="block space-y-1">
                <span className={labelTextClass}>
                  Group{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                {/* Pick an existing group or type a new one; the text is the
                    value either way, exactly as the datalist field sent it. */}
                <Combobox
                  name="group"
                  options={props.groups}
                  value={group}
                  onChange={setGroup}
                  placeholder="e.g. Weekly, Compliance"
                  createLabel={(text) => <>New group “{text}”</>}
                />
              </label>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Public
              <span className="block text-[11px] text-zinc-500">
                {isEdit && metric?.is_public && !isPublic
                  ? "Making this private removes it from every team that tracks it."
                  : 'Other teams can find it in "Add existing measurable" on their scorecard and track it. Private by default.'}
              </span>
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <ModalFooter>
            <Button variant="ghost" onClick={guard.requestClose}>
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

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        message={
          isEdit
            ? "Your edits to this measurable haven't been saved. Close now and they're gone."
            : "This measurable hasn't been added yet. Close now and what you've typed is gone."
        }
      />
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
