"use client";

import { Lock, LockOpen, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
} from "@/components/ui/modal";
import type { SharingChange } from "@/lib/rocks-share";

// The rock modal's sharing surface. The ruleset (lib/rocks-share.ts header):
// a team share is always the whole rock; an assignee from outside the parent
// team sees the whole rock and passes their own milestones to their teams,
// unless a milestone is locked. The modal carries one summary line; the
// controls live in SharingPane; ShareConfirmDialog reviews a save.

type ShareTeam = { id: string; name: string };

/** Mirrors the server cap in actions.ts — firestore.rules unrolls the
 *  shared_team_ids check by index, so the rules only cover this many. */
export const MAX_SHARED_TEAMS = 8;

export type PaneMilestone = {
  key: string;
  title: string;
  ownerId: string;
  ownerName: string;
  locked: boolean;
  /** Set when the lock is inert — see LockToggle's disabledReason. */
  lockReason?: LockReason;
};

/**
 * Why a milestone's lock is inert:
 *   "rock"   — the whole rock is kept on its team
 *   "team"   — the owner is on the rock's team; nothing of theirs travels
 *   "shared" — every team the owner is on already has the whole rock, so a
 *              lock would hide nothing
 */
export type LockReason = "rock" | "team" | "shared";

/** What reaches whom through assignments — derived, never set directly. */
export type AssignmentReach = {
  /** Outside every full team: they get the whole rock. */
  people: { id: string; name: string; teams: string }[];
  /** Teams without a share that see their people's milestones. */
  teams: { id: string; name: string; titles: string[] }[];
};

/** One line in the rock form: who can see this rock, and the way in. */
export function SharingSummary({
  parentTeamName,
  sharedTeams,
  reach,
  lockedCount,
  teamOnly = false,
  onTeamOnlyChange,
  onManage,
}: {
  parentTeamName: string;
  sharedTeams: ShareTeam[];
  reach: AssignmentReach;
  lockedCount: number;
  teamOnly?: boolean;
  /** The "Keep on this team" switch sits beside Manage sharing. */
  onTeamOnlyChange: (on: boolean) => void;
  onManage: () => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-400">
        Sharing
      </div>
      <div className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Users className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] text-zinc-700 dark:text-zinc-300">
          {teamOnly ? (
            <>
              <Lock className="-mt-0.5 inline h-3 w-3" aria-hidden />{" "}
              Kept on <span className="font-semibold">{parentTeamName}</span>
            </>
          ) : sharedTeams.length === 0 ? (
            <>
              Only <span className="font-semibold">{parentTeamName}</span>
            </>
          ) : (
            <>
              <span className="font-semibold">{parentTeamName}</span>
              {" + "}
              {sharedTeams.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <span className="font-semibold">{t.name}</span>
                </span>
              ))}
            </>
          )}
          {reach.teams.length > 0 && (
            <span className="text-zinc-500">
              {" · through assignments: "}
              {reach.teams.map((t) => t.name).join(", ")}
            </span>
          )}
          {lockedCount > 0 && (
            <span className="text-zinc-500">
              {" · "}
              <Lock className="-mt-0.5 inline h-3 w-3" aria-hidden />{" "}
              {lockedCount} kept off {lockedCount === 1 ? "its" : "their"} team
            </span>
          )}
        </p>
        <KeepOnTeamSwitch
          on={teamOnly}
          disabled={sharedTeams.length > 0}
          onChange={onTeamOnlyChange}
        />
        <button
          type="button"
          onClick={onManage}
          className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-[12.5px] font-semibold text-hpb-blue hover:bg-zinc-50 dark:border-zinc-700 dark:text-hpb-gold dark:hover:bg-zinc-800"
        >
          Manage sharing
        </button>
      </div>
    </div>
  );
}

/**
 * "Keep on this team": every milestone locked, including later ones, and
 * no team shares — disabled while any team is shared, as Add teams is while
 * this is on (see parseTeamOnly).
 */
function KeepOnTeamSwitch({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={
        disabled
          ? "Remove the shared teams first — a rock kept on its team isn't shared"
          : "Every milestone stays on this team, including ones added later. Assignees still see the whole rock."
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-[12.5px] font-semibold transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
        "disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 dark:disabled:border-zinc-800",
        on
          ? "border-hpb-blue/40 bg-hpb-blue/[0.07] text-hpb-blue dark:border-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold"
          : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300",
      )}
    >
      <Lock className="h-3.5 w-3.5" aria-hidden />
      Keep on this team
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-hpb-blue dark:bg-hpb-gold" : "bg-zinc-300 dark:bg-zinc-600",
        )}
      >
        <span
          className={cn(
            "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

/**
 * The control pane. Edits the rock modal's draft in place — "Done" only
 * closes it; the rock's Save is still the one commit.
 */
export function SharingPane({
  open,
  onClose,
  parentTeamName,
  shareTeams,
  sharedTeamIds,
  teamOnly,
  milestones,
  reach,
  onTeamsChange,
  onToggleLock,
}: {
  open: boolean;
  onClose: () => void;
  parentTeamName: string;
  /** Every team the rock may be shared into (the org, minus the parent). */
  shareTeams: ShareTeam[];
  sharedTeamIds: string[];
  /** Set from the rock form's "Keep on this team" switch. */
  teamOnly: boolean;
  milestones: PaneMilestone[];
  reach: AssignmentReach;
  onTeamsChange: (next: string[]) => void;
  onToggleLock: (key: string) => void;
}) {
  const nameOf = new Map(shareTeams.map((t) => [t.id, t.name]));
  const hasReach = reach.people.length > 0 || reach.teams.length > 0;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      ariaLabel="Sharing"
      size="2xl"
      portal
    >
      <ModalHeader title="Sharing" onClose={onClose} />
      <ModalBody className="space-y-5">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2.5 text-[12px] sm:grid-cols-[auto_1fr] dark:bg-zinc-800/50">
          <dt className="font-semibold text-zinc-800 dark:text-zinc-200">
            Shared team
          </dt>
          <dd className="text-zinc-500">The whole rock, every milestone.</dd>
          <dt className="font-semibold text-zinc-800 dark:text-zinc-200">
            Assigned from another team
          </dt>
          <dd className="text-zinc-500">
            That person sees the whole rock; their teams see just their
            milestones.
          </dd>
          <dt className="font-semibold text-zinc-800 dark:text-zinc-200">
            <Lock className="-mt-0.5 inline h-3 w-3" aria-hidden /> Kept off
            their team
          </dt>
          <dd className="text-zinc-500">
            The milestone stays with the person — their teams don&apos;t see it.
          </dd>
        </dl>

        <section>
          {/* Left-aligned: the menu is wider than its trigger and opens
              rightward, so a right-aligned trigger would clip it. */}
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-[13px] font-semibold">Teams</h3>
            <MultiSelect
              disabled={teamOnly}
              label="Teams"
              triggerText="Add teams…"
              options={shareTeams.map((t) => ({ value: t.id, label: t.name }))}
              value={new Set(sharedTeamIds)}
              onChange={(next) =>
                // Keep pick order stable: survivors first, new ones after.
                onTeamsChange([
                  ...sharedTeamIds.filter((id) => next.has(id)),
                  ...[...next].filter((id) => !sharedTeamIds.includes(id)),
                ])
              }
              searchable
              max={MAX_SHARED_TEAMS}
              portal
              className="w-48"
            />
          </div>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            <li className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {parentTeamName}
              </span>
              <span className="shrink-0 text-[12px] text-zinc-500">
                {teamOnly ? (
                  <span className="inline-flex items-center gap-1 text-hpb-blue dark:text-hpb-gold">
                    <Lock className="h-3 w-3" aria-hidden />
                    Kept on this team
                  </span>
                ) : (
                  "Parent team · whole rock"
                )}
              </span>
            </li>
            {sharedTeamIds.map((id) => (
              <li key={id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {nameOf.get(id) ?? "Unknown team"}
                </span>
                <span className="shrink-0 text-[12px] text-zinc-500">
                  Whole rock
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onTeamsChange(sharedTeamIds.filter((x) => x !== id))
                  }
                  aria-label={`Stop sharing with ${nameOf.get(id) ?? "team"}`}
                  className="w-6 shrink-0 rounded p-1 text-zinc-400 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {hasReach && (
          <section>
            <h3 className="text-[13px] font-semibold">Through assignments</h3>
            <p className="mb-2 mt-0.5 text-[12px] text-zinc-500">
              Follows from who the milestones are assigned to — change an
              owner or a lock below to change it.
            </p>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {reach.people.map((p) => (
                <li key={`p-${p.id}`} className="flex items-start gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{p.name}</span>
                    {p.teams && (
                      <span className="block truncate text-[11.5px] text-zinc-500">
                        {p.teams}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[12px] text-zinc-600 dark:text-zinc-400">
                    Whole rock · assignee
                  </span>
                </li>
              ))}
              {reach.teams.map((t) => (
                <li key={`t-${t.id}`} className="flex items-start gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.name}</span>
                  <span className="max-w-[60%] shrink-0 truncate text-right text-[12px] text-zinc-600 dark:text-zinc-400">
                    Title +{" "}
                    {t.titles.length === 1
                      ? `“${t.titles[0]}”`
                      : `${t.titles.length} milestones`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {milestones.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Milestones</h3>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {milestones.map((m) => (
                <li key={m.key} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {m.title}
                  </span>
                  <span className="shrink-0 text-[12px] text-zinc-500">
                    {m.ownerName}
                  </span>
                  <LockToggle
                    value={m.locked || teamOnly}
                    onToggle={() => onToggleLock(m.key)}
                    disabled={!!m.lockReason}
                    disabledReason={m.lockReason}
                    withLabel
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </ModalBody>
      <ModalFooter className="px-4 pb-4">
        <Button autoFocus onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

/**
 * Lock toggle for one milestone — used in the pane and on each modal row.
 * Disabled for a parent-team owner: their milestones don't travel, so there
 * is nothing to keep off.
 */
export function LockToggle({
  value,
  onToggle,
  disabled = false,
  disabledReason = "team",
  withLabel = false,
}: {
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledReason?: LockReason;
  withLabel?: boolean;
}) {
  const Icon = value ? Lock : LockOpen;
  const title = disabled
    ? disabledReason === "rock"
      ? "The whole rock is kept on this team"
      : disabledReason === "shared"
        ? "Their team already has the whole rock — nothing to keep off"
        : "Owner is on this rock's team — nothing to keep off"
    : value
      ? "Kept off the assignee's team"
      : "Shown to the assignee's team";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={value}
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        value
          ? "border-hpb-blue/40 bg-hpb-blue/[0.07] text-hpb-blue dark:border-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold"
          : "border-zinc-300 text-zinc-400 hover:text-zinc-700 disabled:hover:text-zinc-400 dark:border-zinc-700 dark:hover:text-zinc-200",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {withLabel && (
        <span className="w-[5.5rem] text-left">
          {disabled
            ? disabledReason === "rock"
              ? "Kept on team"
              : disabledReason === "shared"
                ? "Team has rock"
                : "On this team"
            : value
              ? "Kept off team"
              : "Shown to team"}
        </span>
      )}
    </button>
  );
}

/**
 * Two moments:
 *   - **Adding a rock** — always, parent team first, even when nobody else
 *     will see it.
 *   - **Editing** — when the save changes who sees the rock
 *     (lib/rocks-share.ts sharingChanges): a new team, a new assignee from
 *     outside, a milestone reaching a new team, or an unshared team that
 *     still sees part of the rock.
 */
export function ShareConfirmDialog({
  open,
  creating,
  parentTeamName,
  changes,
  lockedCount,
  teamName,
  pending,
  onBack,
  onConfirm,
}: {
  open: boolean;
  creating: boolean;
  parentTeamName: string;
  changes: SharingChange[];
  lockedCount: number;
  teamName: (id: string) => string;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const added = changes.filter(
    (c): c is Extract<SharingChange, { kind: "team-added" }> =>
      c.kind === "team-added",
  );
  const people = changes.filter(
    (c): c is Extract<SharingChange, { kind: "assignee-added" }> =>
      c.kind === "assignee-added",
  );
  const stillSees = changes.filter(
    (c): c is Extract<SharingChange, { kind: "still-sees" }> =>
      c.kind === "still-sees",
  );
  const reached = new Map<string, { title: string; ownerName: string }[]>();
  for (const c of changes) {
    if (c.kind !== "milestone-to-team") continue;
    const list = reached.get(c.teamId) ?? [];
    list.push({ title: c.title, ownerName: c.ownerName });
    reached.set(c.teamId, list);
  }
  const nobodyElse =
    added.length === 0 && people.length === 0 && reached.size === 0;

  return (
    <ModalShell
      open={open}
      onClose={onBack}
      ariaLabel="Review sharing"
      size="lg"
      portal
    >
      <ModalHeader
        title={creating ? "Who will see this rock" : "Review sharing before saving"}
        onClose={onBack}
      />
      <ModalBody className="space-y-4">
        {creating && (
          <Block title={parentTeamName} tag="Parent team · Whole rock">
            {nobodyElse
              ? "Only this team sees the rock — it isn't shared anywhere else."
              : "Sees the rock and every milestone."}
          </Block>
        )}

        {added.map((c) => (
          <Block key={`t-${c.teamId}`} title={teamName(c.teamId)} tag="Shared · Whole rock">
            Sees the rock, every milestone, and its progress.
          </Block>
        ))}

        {people.map((c) => (
          <Block key={`p-${c.ownerId}`} title={c.ownerName} tag="Assignee · Whole rock">
            Not on this rock&apos;s teams — assigning them a milestone gives
            them the whole rock.
          </Block>
        ))}

        {[...reached.entries()].map(([teamId, items]) => (
          <Block
            key={`r-${teamId}`}
            title={teamName(teamId)}
            tag="Through assignment · No progress"
          >
            Sees the rock&apos;s title and only its people&apos;s milestones:
            <ItemList items={items} />
          </Block>
        ))}

        {stillSees.map((c) => (
          <Block
            key={`s-${c.teamId}`}
            title={teamName(c.teamId)}
            tag="Unshared · Still sees part"
          >
            No longer has the whole rock, but still sees its title and its
            people&apos;s milestones:
            <ItemList items={c.titles.map((title) => ({ title, ownerName: "" }))} />
          </Block>
        ))}

        {lockedCount > 0 && (
          <p className="flex items-center gap-1.5 border-t border-zinc-200 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800">
            <Lock className="h-3 w-3" aria-hidden />
            {lockedCount} milestone{lockedCount === 1 ? " is" : "s are"} kept
            off the assignee&apos;s team.
          </p>
        )}
      </ModalBody>
      <ModalFooter className="px-4 pb-4">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button autoFocus onClick={onConfirm} disabled={pending}>
          {pending
            ? creating
              ? "Adding…"
              : "Saving…"
            : creating
              ? "Add Rock"
              : "Save and share"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

function Block({
  title,
  tag,
  children,
}: {
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <span className="shrink-0 text-[11.5px] font-semibold text-zinc-500">
          {tag}
        </span>
      </div>
      <div className="mt-0.5 text-[12.5px] text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

function ItemList({ items }: { items: { title: string; ownerName: string }[] }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {items.map((m, i) => (
        <li
          key={i}
          className="flex items-baseline gap-2 rounded-md bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200"
        >
          <span className="min-w-0 flex-1 truncate">“{m.title}”</span>
          {m.ownerName && (
            <span className="shrink-0 text-zinc-600 dark:text-zinc-300">
              {m.ownerName}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
