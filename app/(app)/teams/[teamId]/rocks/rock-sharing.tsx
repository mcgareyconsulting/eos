"use client";

import { useState } from "react";
import { Lock, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
} from "@/components/ui/modal";
import { sharingChangeKey, type SharingChange } from "@/lib/rocks-share";

// The rock modal's audience surface (docs/PERMISSIONS_SPEC.md §3.3):
//   - The AUDIENCE (teams and persons) sees and edits the whole rock.
//     Only leaders of the parent team and admins change it; everyone else
//     sees the list read-only.
//   - A milestone ASSIGNEE outside the parent team and the audience sees
//     only their milestone and the rock's title — derived, never set.
//   - PRIVATE (leaders/admins) clears the audience and keeps the rock off
//     every block on other teams.
// The modal carries one summary line; the controls live in AudiencePane;
// ShareConfirmDialog reviews a save.

type Option = { id: string; name: string };

export const PRIVATE_HELP =
  "Private rocks do not show on the L10 of your other teams.";

/** Assignees who will see only their milestone(s) — derived, never set. */
export type HeadlinePerson = { id: string; name: string; teams: string; titles: string[] };

/** One line in the rock form: who can see this rock. */
export function AudienceSummary({
  parentTeamName,
  audienceTeams,
  audiencePeople,
  headlinePeople,
  isPrivate,
  canManage,
  onPrivateChange,
  onManage,
}: {
  parentTeamName: string;
  audienceTeams: Option[];
  audiencePeople: Option[];
  headlinePeople: HeadlinePerson[];
  isPrivate: boolean;
  /** Leader of the parent team or admin (rockAccess.canChangeAudience). */
  canManage: boolean;
  onPrivateChange: (on: boolean) => void;
  onManage: () => void;
}) {
  const extra = [...audienceTeams, ...audiencePeople];
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-400">
        Who sees this rock
      </div>
      <div className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Users className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] text-zinc-700 dark:text-zinc-300">
          {isPrivate ? (
            <>
              <Lock className="-mt-0.5 inline h-3 w-3" aria-hidden />{" "}
              Private to <span className="font-semibold">{parentTeamName}</span>
            </>
          ) : extra.length === 0 ? (
            <>
              Only <span className="font-semibold">{parentTeamName}</span>
            </>
          ) : (
            <>
              <span className="font-semibold">{parentTeamName}</span>
              {" + "}
              {extra.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <span className="font-semibold">{t.name}</span>
                </span>
              ))}
            </>
          )}
          {headlinePeople.length > 0 && (
            <span className="text-zinc-500">
              {" · only their milestone: "}
              {headlinePeople.map((p) => p.name).join(", ")}
            </span>
          )}
        </p>
        <PrivateSwitch
          on={isPrivate}
          disabled={!canManage}
          onChange={onPrivateChange}
        />
        <button
          type="button"
          onClick={onManage}
          className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-[12.5px] font-semibold text-hpb-blue hover:bg-zinc-50 dark:border-zinc-700 dark:text-hpb-gold dark:hover:bg-zinc-800"
        >
          {canManage ? "Manage audience" : "View audience"}
        </button>
      </div>
      {!canManage && (
        <p className="mt-1 text-[11px] text-zinc-500">
          Only a leader of {parentTeamName} or an admin can change the audience
          or make the rock private.
        </p>
      )}
    </div>
  );
}

/** Private: leader/admin only. Turning it on clears the audience. */
function PrivateSwitch({
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
          ? `${PRIVATE_HELP} Only a leader of this team or an admin can change it.`
          : `${PRIVATE_HELP} Turning it on removes the audience.`
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
      Private
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
 * The audience pane. Edits the rock modal's draft in place — "Done" only
 * closes it; the rock's Save is still the one commit. Read-only unless
 * `canManage`.
 *
 * Layout (Daniel, 2026-10-29): two columns on top — YOUR TEAM (the parent
 * team and its roster, who always have the whole rock) on the left, OTHER
 * TEAMS (a checklist; ticked = in the audience) on the right — and PEOPLE
 * underneath (individual persons in the audience, from anywhere in the org).
 */
export function AudiencePane({
  open,
  onClose,
  parentTeamName,
  parentMembers = [],
  teamOptions,
  personOptions,
  audienceTeamIds,
  audienceUserIds,
  isPrivate,
  canManage,
  headlinePeople,
  onTeamsChange,
  onUsersChange,
}: {
  open: boolean;
  onClose: () => void;
  parentTeamName: string;
  /** The parent team's roster — listed under "Your team", read-only. */
  parentMembers?: Option[];
  /** Every team that may be in the audience (the org, minus the parent). */
  teamOptions: Option[];
  /** Everyone in the directory; null while it loads. */
  personOptions: Option[] | null;
  audienceTeamIds: string[];
  audienceUserIds: string[];
  isPrivate: boolean;
  canManage: boolean;
  headlinePeople: HeadlinePerson[];
  onTeamsChange: (next: string[]) => void;
  onUsersChange: (next: string[]) => void;
}) {
  const personName = new Map((personOptions ?? []).map((p) => [p.id, p.name]));
  const editable = canManage && !isPrivate;
  // Keep pick order stable: survivors first, new ones after.
  const merge = (prev: string[], next: Set<string>) => [
    ...prev.filter((id) => next.has(id)),
    ...[...next].filter((id) => !prev.includes(id)),
  ];
  const teams = [...teamOptions].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const roster = [...parentMembers].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const [teamQuery, setTeamQuery] = useState("");
  const shownTeams = teamQuery.trim()
    ? teams.filter((t) => t.name.toLowerCase().includes(teamQuery.trim().toLowerCase()))
    : teams;

  function toggleTeam(id: string) {
    if (audienceTeamIds.includes(id)) {
      onTeamsChange(audienceTeamIds.filter((x) => x !== id));
    } else {
      onTeamsChange([...audienceTeamIds, id]);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} ariaLabel="Audience" size="2xl" portal>
      <ModalHeader title="Audience" onClose={onClose} />
      <ModalBody className="space-y-5">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2.5 text-[12px] sm:grid-cols-[auto_1fr] dark:bg-zinc-800/50">
          <dt className="font-semibold text-zinc-800 dark:text-zinc-200">
            Audience (teams and people)
          </dt>
          <dd className="text-zinc-500">
            Sees and edits the whole rock. Cannot delete it or change the
            audience.
          </dd>
          <dt className="font-semibold text-zinc-800 dark:text-zinc-200">
            Assigned a milestone
          </dt>
          <dd className="text-zinc-500">
            Sees only their milestone by name, under Other milestones on
            their team&apos;s Rocks page, plus the rock&apos;s title, owner and team.
          </dd>
          <dt className="font-semibold text-zinc-800 dark:text-zinc-200">
            <Lock className="-mt-0.5 inline h-3 w-3" aria-hidden /> Private
          </dt>
          <dd className="text-zinc-500">{PRIVATE_HELP}</dd>
        </dl>

        {isPrivate && (
          <p className="text-[12.5px] text-zinc-600 dark:text-zinc-400">
            This rock is private: it has no audience, and every milestone must
            be assigned to someone on {parentTeamName}.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Left: the parent team — always the whole rock, nothing to pick. */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold">Your team</h3>
              <span className="text-[11.5px] text-zinc-500">Whole rock · always</span>
            </div>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              <li className="flex items-center gap-3 bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {parentTeamName}
                </span>
                <span className="shrink-0 text-[12px] text-zinc-500">Parent team</span>
              </li>
              {roster.map((m) => (
                <li key={m.id} className="px-3 py-1.5 text-[12.5px] text-zinc-700 dark:text-zinc-300">
                  {m.name}
                </li>
              ))}
              {roster.length === 0 && (
                <li className="px-3 py-2 text-[12.5px] text-zinc-400">No members yet</li>
              )}
            </ul>
          </section>

          {/* Right: every other team, ticked when in the audience. */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold">Other teams</h3>
              <span className="text-[11.5px] text-zinc-500">
                {audienceTeamIds.length === 0
                  ? "None share it"
                  : `${audienceTeamIds.length} share${audienceTeamIds.length === 1 ? "s" : ""} it`}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              {teams.length > 8 && (
                <input
                  value={teamQuery}
                  onChange={(e) => setTeamQuery(e.target.value)}
                  placeholder="Find a team…"
                  aria-label="Find a team"
                  className="w-full border-b border-zinc-200 bg-transparent px-3 py-1.5 text-[12.5px] focus:outline-none dark:border-zinc-800"
                />
              )}
              <ul className="max-h-64 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
                {shownTeams.map((t) => {
                  const on = audienceTeamIds.includes(t.id);
                  return (
                    <li key={t.id}>
                      <label
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-1.5 text-[12.5px]",
                          editable
                            ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                            : "text-zinc-500",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!editable}
                          onChange={() => toggleTeam(t.id)}
                          className="h-3.5 w-3.5 accent-hpb-blue disabled:cursor-not-allowed dark:accent-hpb-gold"
                        />
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {on && (
                          <span className="shrink-0 text-[11.5px] text-zinc-500">Whole rock</span>
                        )}
                      </label>
                    </li>
                  );
                })}
                {shownTeams.length === 0 && (
                  <li className="px-3 py-2 text-[12.5px] text-zinc-400">
                    {teams.length === 0 ? "No other teams" : "No team matches"}
                  </li>
                )}
              </ul>
            </div>
          </section>
        </div>

        {/* Below: individual people, from any team. Their teammates do not
            see the rock through them. */}
        <AudienceList
          title="People"
          hint="Each person sees the whole rock on their own Rocks page and Home. Their teammates do not."
          ids={audienceUserIds}
          nameOf={(id) => personName.get(id) ?? "Someone"}
          editable={editable}
          picker={
            <MultiSelect
              disabled={!editable || !personOptions}
              label="People"
              triggerText={personOptions ? "Add people…" : "Loading…"}
              options={(personOptions ?? []).map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              value={new Set(audienceUserIds)}
              onChange={(next) => onUsersChange(merge(audienceUserIds, next))}
              searchable
              portal
              className="w-48"
            />
          }
          onRemove={(id) => onUsersChange(audienceUserIds.filter((x) => x !== id))}
        />

        {headlinePeople.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold">Only their milestone</h3>
            <p className="mb-2 mt-0.5 text-[12px] text-zinc-500">
              Assignees outside {parentTeamName} and the audience. They see
              their milestone under Other milestones; add them to the audience
              to give them the whole rock.
            </p>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {headlinePeople.map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{p.name}</span>
                    {p.teams && (
                      <span className="block truncate text-[11.5px] text-zinc-500">
                        {p.teams}
                      </span>
                    )}
                  </span>
                  <span className="max-w-[60%] shrink-0 truncate text-right text-[12px] text-zinc-600 dark:text-zinc-400">
                    {p.titles.length === 1
                      ? `“${p.titles[0]}”`
                      : `${p.titles.length} milestones`}
                  </span>
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

function AudienceList({
  title,
  hint,
  ids,
  nameOf,
  editable,
  picker,
  onRemove,
}: {
  title: string;
  hint?: string;
  ids: string[];
  nameOf: (id: string) => string;
  editable: boolean;
  picker: React.ReactNode;
  onRemove: (id: string) => void;
}) {
  return (
    <section>
      {/* Left-aligned: the menu is wider than its trigger and opens
          rightward, so a right-aligned trigger would clip it. */}
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {editable && picker}
      </div>
      {hint && <p className="-mt-1 mb-2 text-[12px] text-zinc-500">{hint}</p>}
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {ids.map((id) => (
          <li key={id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px]">{nameOf(id)}</span>
            <span className="shrink-0 text-[12px] text-zinc-500">Whole rock</span>
            {editable && (
              <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label={`Remove ${nameOf(id)} from the audience`}
                className="w-6 shrink-0 rounded p-1 text-zinc-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
        {ids.length === 0 && (
          <li className="px-3 py-2 text-[12.5px] text-zinc-400">None</li>
        )}
      </ul>
    </section>
  );
}

/**
 * Two moments:
 *   - **Adding a rock** — always, parent team first.
 *   - **Editing** — when the save changes who sees the rock
 *     (lib/rocks-share.ts sharingChanges): a team or person joins the
 *     audience, an assignee will see only their milestone, a milestone
 *     reaches a new block, or the rock becomes private.
 * Either way it lists everyone who will see the rock (`picture`), not just
 * what this save changes — what's new carries a "New" badge, and anyone
 * this save drops from the audience is listed as losing it.
 */
export function ShareConfirmDialog({
  open,
  creating,
  parentTeamName,
  changes,
  picture,
  removed,
  teamName,
  personName,
  pending,
  onBack,
  onConfirm,
}: {
  open: boolean;
  creating: boolean;
  parentTeamName: string;
  /** What this save changes — decides the "New" badges and Private. */
  changes: SharingChange[];
  /** Everyone the saved rock reaches (lib/rocks-share.ts sharingPicture). */
  picture: SharingChange[];
  /** Audience this save drops while the rock stays shared. */
  removed: { teamIds: string[]; userIds: string[] };
  teamName: (id: string) => string;
  personName: (id: string) => string;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const of = <K extends SharingChange["kind"]>(kind: K) =>
    picture.filter((c): c is Extract<SharingChange, { kind: K }> => c.kind === kind);
  const newKeys = new Set(changes.map(sharingChangeKey));
  // A new rock is all new; badges only mean something on an edit.
  const isNew = (c: SharingChange) => !creating && newKeys.has(sharingChangeKey(c));
  const teams = of("team-added");
  const people = of("person-added");
  const headline = of("headline-only");
  const priv = changes.find(
    (c): c is Extract<SharingChange, { kind: "private-on" }> => c.kind === "private-on",
  );
  const blocks = new Map<string, { title: string; ownerName: string; isNew: boolean }[]>();
  for (const c of of("block-added")) {
    const list = blocks.get(c.teamId) ?? [];
    list.push({ title: c.title, ownerName: c.ownerName, isNew: isNew(c) });
    blocks.set(c.teamId, list);
  }
  const lost = [
    ...removed.teamIds.map((id) => teamName(id)),
    ...removed.userIds.map((id) => personName(id)),
  ];
  const nobodyElse =
    teams.length === 0 && people.length === 0 && headline.length === 0 && blocks.size === 0;

  const quoted = (titles: string[]) =>
    titles.length === 1
      ? `“${titles[0]}”`
      : titles.map((t) => `“${t}”`).join(", ");

  return (
    <ModalShell open={open} onClose={onBack} ariaLabel="Review who sees this rock" size="lg" portal>
      <ModalHeader
        title={creating ? "Who will see this rock" : "Review who sees this rock"}
        onClose={onBack}
      />
      <ModalBody className="space-y-4">
        <Block title={parentTeamName} tag="Parent team · Whole rock">
          {nobodyElse
            ? "Only this team sees the rock."
            : "Sees and edits the rock and every milestone."}
        </Block>

        {priv && (
          <Block title="Private" tag="Loses access">
            {PRIVATE_HELP} These lose the rock:
            <ul className="mt-1.5 space-y-1">
              {[
                ...priv.teamIds.map((id) => `${teamName(id)} (audience)`),
                ...priv.userIds.map((id) => `${personName(id)} (audience)`),
                ...priv.blockTeamIds.map((id) => `${teamName(id)} (members' blocks)`),
              ].map((line) => (
                <li
                  key={line}
                  className="rounded-md bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200"
                >
                  {line}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {teams.map((c) => (
          <Block
            key={`t-${c.teamId}`}
            title={teamName(c.teamId)}
            tag="Audience · Whole rock"
            isNew={isNew(c)}
          >
            {teamName(c.teamId)} sees the whole rock and can edit it.
          </Block>
        ))}

        {people.map((c) => (
          <Block
            key={`p-${c.userId}`}
            title={personName(c.userId)}
            tag="Audience · Whole rock"
            isNew={isNew(c)}
          >
            {personName(c.userId)} sees the whole rock and can edit it.
          </Block>
        ))}

        {headline.map((c) => {
          const teamsLabel = c.ownerTeamIds.map(teamName).join(", ");
          return (
            <Block
              key={`h-${c.ownerId}`}
              title={teamsLabel ? `${c.ownerName} (${teamsLabel})` : c.ownerName}
              tag="Assignee · Only their milestone"
              isNew={isNew(c)}
            >
              {c.ownerName}
              {teamsLabel ? ` (${teamsLabel})` : ""} sees only{" "}
              {quoted(c.titles)} and the rock&apos;s title. Add them to the
              audience to give them the whole rock.
            </Block>
          );
        })}

        {[...blocks.entries()].map(([teamId, items]) => (
          <Block
            key={`b-${teamId}`}
            title={teamName(teamId)}
            tag="Block · Title only"
            isNew={items.some((m) => m.isNew)}
          >
            Sees in their members&apos; blocks, read-only, with the
            rock&apos;s title:
            <ul className="mt-1.5 space-y-1">
              {items.map((m, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-2 rounded-md bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200"
                >
                  <span className="min-w-0 flex-1 truncate">“{m.title}”</span>
                  {m.isNew && items.some((x) => !x.isNew) && <NewBadge />}
                  <span className="shrink-0 text-zinc-600 dark:text-zinc-300">
                    {m.ownerName}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        ))}

        {lost.length > 0 && (
          <Block title="No longer in the audience" tag="Loses access">
            This save removes them from the audience:
            <ul className="mt-1.5 space-y-1">
              {lost.map((name, i) => (
                <li
                  key={i}
                  className="rounded-md bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200"
                >
                  {name}
                </li>
              ))}
            </ul>
          </Block>
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
              : "Save"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

function Block({
  title,
  tag,
  isNew = false,
  children,
}: {
  title: string;
  tag: string;
  /** This save adds it (the dialog lists everyone, not just changes). */
  isNew?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-baseline gap-1.5 text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="min-w-0 truncate">{title}</span>
          {isNew && <NewBadge />}
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

function NewBadge() {
  return (
    <span className="shrink-0 rounded-full bg-hpb-green/10 px-1.5 py-px text-[10.5px] font-semibold text-hpb-green ring-1 ring-inset ring-hpb-green/25">
      New
    </span>
  );
}
