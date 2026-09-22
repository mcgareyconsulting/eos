"use client";

import { useEffect, useState, useTransition } from "react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  createRockWithMilestones,
  loadOrgPeople,
  updateRockWithMilestones,
} from "./actions";
import {
  OwnerPicker,
  type OrgPerson,
} from "./owner-picker";
import {
  LockToggle,
  type AssignmentReach,
  ShareConfirmDialog,
  SharingPane,
  SharingSummary,
} from "./rock-sharing";
import {
  sharingChanges,
  type SharingSnapshot,
  type SharingChange,
} from "@/lib/rocks-share";
import {
  ROCK_KIND_OPTIONS,
  isCompanyRock,
  kindForForm,
  type RockType,
} from "./rock-type";
import type { MilestoneSerialized } from "./milestone-checklist";
import { IconButton } from "@/components/ui/button";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalShell,
  useDiscardGuard,
} from "@/components/ui/modal";

type Member = { user_id: string; full_name: string };
type ShareTeam = { id: string; name: string };

type DraftMilestone = {
  /** React key; also the todo doc id when this row already exists. */
  key: string;
  id?: string;
  title: string;
  owner_id: string;
  due_date: string;
  /** Locked: not passed on to the assignee's teams (lib/rocks-share.ts). */
  locked: boolean;
};

type RockForEdit = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  quarter: string;
  due_date: string | null;
  rock_type?: string | null;
  is_company_rock?: boolean | null;
  shared_team_ids?: string[] | null;
  team_only?: boolean | null;
};

/**
 * Whole-org people for the owner picker, shared by every rock modal on the
 * page. Fetched when a modal opens — not when the page renders its rows, and
 * not when someone first clicks "Whole org", which made them wait on a round
 * trip. Kept for the page's life: a person added mid-session appears after a
 * refresh, which is fine for a picker. A failed fetch clears itself so the
 * next modal retries.
 */
let orgPeopleCache: Promise<OrgPerson[]> | null = null;
function fetchOrgPeople(teamId: string): Promise<OrgPerson[]> {
  orgPeopleCache ??= loadOrgPeople(teamId).catch((err) => {
    orgPeopleCache = null;
    throw err;
  });
  return orgPeopleCache;
}

let draftSeq = 0;
function blankRow(ownerId: string): DraftMilestone {
  draftSeq += 1;
  return {
    key: `draft-${draftSeq}`,
    title: "",
    owner_id: ownerId,
    due_date: "",
    locked: false,
  };
}

/**
 * Milestone rows folded to one string so the whole rock draft compares with a
 * single shallow rule (see draftChanged).
 *
 * Only rows carrying a title are included, which is what makes "add a row"
 * not count as unsaved work: a fresh rock opens with three blank rows and
 * clicking + for a fourth has typed nothing into it. A row with words in it
 * is work; an empty row is furniture.
 */
function serializeRows(rows: DraftMilestone[]): string {
  return JSON.stringify(
    rows
      .filter((r) => r.title.trim())
      .map((r) => [r.id ?? "", r.title, r.owner_id, r.due_date, r.locked]),
  );
}

function personOwnerId(
  ownerId: string | null | undefined,
  fallback: string,
): string {
  if (!ownerId || ownerId === "team") return fallback;
  return ownerId;
}

/** Header button on the Rocks page. Replaces AddRockDrawer. */
export function NewRockButton({
  teamId,
  members,
  quarter,
  defaultDue,
  currentUserId,
  teamName,
  shareTeams = [],
  canFlagCompany = false,
}: {
  teamId: string;
  members: Member[];
  quarter: string;
  defaultDue: string;
  currentUserId: string;
  teamName?: string;
  shareTeams?: ShareTeam[];
  canFlagCompany?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Was a one-off set of magic values — `font-extrabold`,
        // `text-[12.5px]`, `rounded-[9px]`, `py-[7px]`, a hardcoded hover hex
        // and a heavier icon stroke — which made this the only add button in
        // the app in a different weight and size from the rest of its own
        // header row. Shared chrome now; if Rocks wants a louder button, that
        // is a decision for every page at once.
        className={entityAddButtonClass}
      >
        <Plus className="h-4 w-4" />
        Add Rock
      </button>
      {open && (
        <RockModal
          teamId={teamId}
          members={members}
          quarter={quarter}
          defaultDue={defaultDue}
          currentUserId={currentUserId}
          teamName={teamName}
          shareTeams={shareTeams}
          canFlagCompany={canFlagCompany}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Pencil in the rock row. Replaces EditRockDrawer. */
export function EditRockButton({
  teamId,
  rock,
  members,
  milestones,
  defaultDue,
  currentUserId,
  teamName,
  shareTeams = [],
  canFlagCompany = false,
  className,
}: {
  teamId: string;
  rock: RockForEdit;
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
  currentUserId: string;
  teamName?: string;
  shareTeams?: ShareTeam[];
  canFlagCompany?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit rock"
        aria-label="Edit rock"
        className={cn(
          "rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-hpb-blue dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-hpb-gold",
          className,
        )}
      >
        <Pencil className="h-[15px] w-[15px]" />
      </button>
      {open && (
        <RockModal
          teamId={teamId}
          members={members}
          defaultDue={defaultDue}
          currentUserId={currentUserId}
          teamName={teamName}
          shareTeams={shareTeams}
          canFlagCompany={canFlagCompany}
          rock={rock}
          milestones={milestones}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Create/edit: parent team (context), rock kind, person owner, optional share,
 * rich description, milestones.
 */
export function RockModal({
  teamId,
  members,
  quarter,
  defaultDue,
  currentUserId,
  teamName,
  shareTeams = [],
  canFlagCompany = false,
  rock,
  milestones = [],
  focusMilestones = false,
  onClose,
}: {
  teamId: string;
  members: Member[];
  /** Create-mode default only — edit mode reads the rock's own quarter. */
  quarter?: string;
  defaultDue: string;
  currentUserId: string;
  teamName?: string;
  shareTeams?: ShareTeam[];
  /**
   * Org admin — the only role that may set or clear the Company flag. When
   * false the checkbox is not rendered; the server preserves the stored
   * value on save regardless of what the form sends.
   */
  canFlagCompany?: boolean;
  /** Present = edit mode. */
  rock?: RockForEdit;
  milestones?: MilestoneSerialized[];
  /** Open with a fresh milestone row focused instead of the rock title. */
  focusMilestones?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing = !!rock;
  // Names the page already resolved for off-roster owners (owner_label).
  const labelById = new Map(
    milestones
      .filter((m) => m.owner_id && m.owner_label)
      .map((m) => [m.owner_id as string, m.owner_label as string]),
  );
  const initialOwner = personOwnerId(rock?.owner_id, currentUserId);
  // The kind radio is two-way; a legacy "company" rock_type opens as Team
  // here and its Company half is carried by the checkbox below instead.
  const initialType = kindForForm(rock?.rock_type);

  const [title, setTitle] = useState(rock?.title ?? "");
  const [description, setDescription] = useState(rock?.description ?? "");
  const [ownerId, setOwnerId] = useState(initialOwner);
  const [rockType, setRockType] = useState<RockType>(initialType);
  const [companyRock, setCompanyRock] = useState(
    rock ? isCompanyRock(rock) : false,
  );
  const [sharedTeamIds, setSharedTeamIds] = useState<string[]>(() => {
    const ids = rock?.shared_team_ids ?? [];
    return ids.filter((id) => id && id !== teamId);
  });
  const [teamOnly, setTeamOnly] = useState(rock?.team_only === true);
  const [orgPeople, setOrgPeople] = useState<OrgPerson[] | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [changes, setChanges] = useState<SharingChange[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [qtr, setQtr] = useState(rock?.quarter ?? quarter ?? "");
  // Due is a create-mode suggestion only. An existing rock with a
  // cleared due date stays empty — never re-seed end-of-quarter on edit.
  const [due, setDue] = useState(rock ? (rock.due_date ?? "") : defaultDue);

  const inheritOwner = ownerId || currentUserId;

  const [rows, setRows] = useState<DraftMilestone[]>(() => {
    const base = editing
      ? milestones.map((m) => ({
          key: m.id,
          id: m.id,
          title: m.title,
          owner_id: m.owner_id ?? currentUserId,
          due_date: m.due_date ?? "",
          locked: m.locked === true,
        }))
      : [
          blankRow(currentUserId),
          blankRow(currentUserId),
          blankRow(currentUserId),
        ];
    return focusMilestones ? [...base, blankRow(inheritOwner)] : base;
  });
  const [focusKey, setFocusKey] = useState<string | null>(() =>
    focusMilestones ? (rows[rows.length - 1]?.key ?? null) : null,
  );

  // Frozen at mount, which *is* "when it opened": both NewRockButton and
  // EditRockButton mount this component only while the modal is open, so the
  // values the state hooks above just seeded are the values the user was
  // shown. Freezing matters — a router.refresh() elsewhere can hand this
  // component a newer `rock` prop mid-edit, and a baseline recomputed from
  // props would quietly move under the comparison.
  const [opened] = useState(() => ({
    title,
    description,
    ownerId,
    rockType,
    companyRock,
    sharedTeamIds: sharedTeamIds.join(","),
    teamOnly,
    qtr,
    due,
    milestones: serializeRows(rows),
  }));
  // The sharing baseline is kept raw and turned into a snapshot at save
  // time, with the same owner→teams lookup as the draft: the org list that
  // lookup needs is still loading at mount, and a baseline built then would
  // report every existing assignment as new.
  const [openedSharing] = useState(() => ({
    teams: sharedTeamIds,
    rows,
    teamOnly,
  }));

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(
    draftChanged(
      {
        title,
        description,
        ownerId,
        rockType,
        companyRock,
        sharedTeamIds: sharedTeamIds.join(","),
        teamOnly,
        qtr,
        due,
        milestones: serializeRows(rows),
      },
      opened,
    ),
    onClose,
  );

  const filled = rows.filter((r) => r.title.trim());

  function patchRow(key: string, patch: Partial<DraftMilestone>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const shareTeamName = new Map(shareTeams.map((t) => [t.id, t.name]));
  const teamNameById = new Map(shareTeamName);
  teamNameById.set(teamId, teamName ?? "This team");
  const nameById = new Map<string, string>();
  for (const p of orgPeople ?? []) nameById.set(p.user_id, p.full_name);
  for (const p of members) nameById.set(p.user_id, p.full_name);
  const ownerNameOf = (id: string) =>
    nameById.get(id) ?? labelById.get(id) ?? "Current owner";
  const parentIds = new Set(members.map((m) => m.user_id));
  // An owner's teams, from the org list (prefetched on open). Before it
  // arrives, only "on this team" is known.
  const teamIdsOf = (id: string): string[] =>
    orgPeople?.find((p) => p.user_id === id)?.team_ids ??
    (parentIds.has(id) ? [teamId] : []);
  const teamNamesOf = (id: string) =>
    teamIdsOf(id)
      .map((t) => teamNameById.get(t) ?? "Team")
      .join(", ");
  const snapshotOf = (teams: string[], rs: DraftMilestone[], only: boolean) =>
    sharingSnapshot(teamId, teams, rs, only, inheritOwner, ownerNameOf, teamIdsOf);

  // Prefetch on open (see orgPeopleCache). The picker's own request is the
  // retry path if this one failed.
  useEffect(() => {
    let cancelled = false;
    fetchOrgPeople(teamId)
      .then((people) => {
        if (!cancelled) setOrgPeople(people);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Who reaches the rock through assignments (lib/rocks-share.ts): people
  // outside every full team get the whole rock; their teams without a
  // share see just their unlocked milestones. Only known once the org list
  // has loaded — nothing shows until then rather than guessing.
  const fullTeams = new Set([teamId, ...sharedTeamIds]);
  const reach: AssignmentReach = { people: [], teams: [] };
  if (orgPeople) {
    const seenPeople = new Set<string>();
    const byTeam = new Map<string, string[]>();
    for (const r of filled) {
      const owner = r.owner_id || inheritOwner;
      if (parentIds.has(owner)) continue;
      const teams = teamIdsOf(owner);
      if (!teams.some((t) => fullTeams.has(t)) && !seenPeople.has(owner)) {
        seenPeople.add(owner);
        reach.people.push({
          id: owner,
          name: ownerNameOf(owner),
          teams: teamNamesOf(owner),
        });
      }
      if (r.locked || teamOnly) continue;
      for (const t of teams) {
        if (fullTeams.has(t)) continue;
        const list = byTeam.get(t) ?? [];
        list.push(r.title.trim());
        byTeam.set(t, list);
      }
    }
    for (const [id, titles] of byTeam) {
      reach.teams.push({ id, name: teamNameById.get(id) ?? "Team", titles });
    }
  }
  // Everyone on the rock's full teams — only for the picker's "outside"
  // dot, and only once known.
  const insideIds = orgPeople
    ? new Set(
        orgPeople
          .filter((p) => p.team_ids.some((t) => fullTeams.has(t)))
          .map((p) => p.user_id),
      )
    : undefined;
  // Individually locked milestones; with "Keep on this team" on, the rock
  // itself says it and the per-milestone count would only repeat it.
  // Why a row's lock is inert, if it is: the rock is kept on its team; the
  // owner is on the parent team (nothing of theirs travels); or every team
  // the owner is on already has the rock in full, so a lock would hide
  // nothing (item 1 of the 2026-09-22 review). Undefined = live.
  const lockReasonFor = (
    ownerId: string,
  ): "rock" | "team" | "shared" | undefined => {
    if (teamOnly) return "rock";
    if (parentIds.has(ownerId)) return "team";
    const teams = teamIdsOf(ownerId);
    if (orgPeople && teams.length > 0 && teams.every((t) => fullTeams.has(t))) {
      return "shared";
    }
    return undefined;
  };
  const lockedCount = teamOnly
    ? 0
    : filled.filter(
        (r) => r.locked && !parentIds.has(r.owner_id || inheritOwner),
      ).length;

  function needOrg() {
    if (orgPeople) return;
    fetchOrgPeople(teamId)
      .then(setOrgPeople)
      .catch(() => {});
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    if (!ownerId || ownerId === "team") {
      setError("Owner is required — pick a person accountable for this rock.");
      return;
    }
    const changed = sharingChanges(
      snapshotOf(openedSharing.teams, openedSharing.rows, openedSharing.teamOnly),
      snapshotOf(sharedTeamIds, rows, teamOnly),
    );
    // Adding always reviews who will see the rock; editing only when the
    // save changes it (see ShareConfirmDialog).
    if (!editing || changed.length > 0) {
      setChanges(changed);
      setConfirming(true);
      return;
    }
    save();
  }

  function save() {
    const fd = new FormData();
    fd.set("title", title);
    fd.set("description", description);
    fd.set("owner_id", ownerId);
    fd.set("rock_type", rockType);
    fd.set("is_company_rock", companyRock ? "true" : "false");
    fd.set("shared_team_ids", JSON.stringify(sharedTeamIds));
    fd.set("team_only", teamOnly ? "true" : "false");
    // The milestones this modal was shown: only these may be deleted by
    // leaving them out (see updateRockWithMilestones).
    fd.set("known_milestone_ids", JSON.stringify(milestones.map((m) => m.id)));
    fd.set("quarter", qtr);
    fd.set("due_date", due);
    fd.set(
      "milestones",
      JSON.stringify(
        filled.map((r) => ({
          id: r.id,
          title: r.title.trim(),
          owner_id: r.owner_id || inheritOwner,
          due_date: r.due_date || null,
          locked: r.locked,
        })),
      ),
    );

    start(async () => {
      try {
        setError(null);
        if (rock) await updateRockWithMilestones(teamId, rock.id, fd);
        else await createRockWithMilestones(teamId, fd);
        onClose();
        router.refresh();
      } catch (err) {
        setConfirming(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <ModalShell
      open
      onClose={guard.requestClose}
      // Escape belongs to whichever dialog is stacked on top.
      dismissible={!guard.asking && !paneOpen && !confirming}
      ariaLabel={editing ? "Edit Rock" : "Add Rock"}
      size="5xl"
    >
        {/* Header padding (px-6 py-3.5) differs from the shared ModalHeader's
            px-5 py-3, so this stays a bespoke header rather than using it. */}
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3.5 dark:border-zinc-800">
          <div>
            {teamName && (
              <div className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-zinc-400">
                {teamName}
                <span className="font-medium normal-case tracking-normal text-zinc-400">
                  {" "}
                  · parent team
                </span>
              </div>
            )}
            <h2 className="mt-0.5 text-base font-semibold">
              {editing ? "Edit Rock" : "Add Rock"}
            </h2>
          </div>
          <IconButton onClick={guard.requestClose} aria-label="Close">
            <X className="h-4 w-4" />
          </IconButton>
        </header>

        <form onSubmit={submit} className="flex flex-1 flex-col overflow-y-auto">
          <div className="space-y-4 px-6 py-5">
            <Field label="Title" required>
              <input
                autoFocus={!focusMilestones}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. EOS platform deployment"
                className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </Field>

            <div>
              <div className="mb-1.5 text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-400">
                Rock kind <span className="text-red-600">*</span>
              </div>
              {/* One line: the Individual/Team segmented pair, then the
                  Company flag beside it — a separate axis, not a third kind. */}
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="radiogroup"
                  aria-label="Rock kind"
                  className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700"
                >
                  {ROCK_KIND_OPTIONS.map((opt) => {
                    const selected = rockType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setRockType(opt.value)}
                        className={cn(
                          "rounded px-3 py-1 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
                          selected
                            ? "bg-hpb-blue text-white"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {canFlagCompany ? (
                  <label
                    title="Admins only — leads the list ahead of the Team section"
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-semibold transition-colors",
                      companyRock
                        ? "border-hpb-blue bg-hpb-blue/[0.07] text-hpb-blue dark:bg-hpb-blue/15 dark:text-white"
                        : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={companyRock}
                      onChange={(e) => setCompanyRock(e.target.checked)}
                      className="h-3.5 w-3.5 accent-hpb-blue"
                    />
                    Company Rock
                  </label>
                ) : companyRock ? (
                  // Non-admins see the flag, not an input that would no-op —
                  // the server keeps the stored value on save.
                  <span
                    title="Set by an admin — saving keeps it"
                    className="rounded-md bg-hpb-blue/[0.07] px-2.5 py-1 text-[13px] font-semibold text-hpb-blue dark:bg-hpb-blue/15 dark:text-hpb-gold"
                  >
                    Company Rock
                  </span>
                ) : null}
              </div>
            </div>

            <Field label="Description" hint="(optional)">
              <RichTextEditor
                value={description}
                onChange={setDescription}
                placeholder="A short success criterion."
                rows={3}
              />
            </Field>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Field label="Owner" required>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[13.5px] dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Accountable person — even for team rocks.
                </p>
              </Field>
              <Field label="Quarter">
                <input
                  value={qtr}
                  onChange={(e) => setQtr(e.target.value)}
                  placeholder="e.g. 2026-Q3"
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[13.5px] dark:border-zinc-700 dark:bg-zinc-900"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Free text — calendar Q, fiscal period, or custom label.
                </p>
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[13.5px] dark:border-zinc-700 dark:bg-zinc-900"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Optional — clear it if there is no date yet.
                </p>
              </Field>
            </div>

            {shareTeams.length > 0 && (
              <SharingSummary
                parentTeamName={teamName ?? "This team"}
                sharedTeams={sharedTeamIds.map((id) => ({
                  id,
                  name: shareTeamName.get(id) ?? "Unknown team",
                }))}
                reach={reach}
                lockedCount={lockedCount}
                teamOnly={teamOnly}
                onTeamOnlyChange={setTeamOnly}
                onManage={() => setPaneOpen(true)}
              />
            )}

            <div className="border-t border-zinc-200 pt-3.5 dark:border-zinc-800">
              <div className="mb-2">
                <span className="text-[13px] font-semibold">Milestones</span>{" "}
                <span className="text-[11.5px] text-zinc-400">
                  {filled.length === 0
                    ? "none yet"
                    : `${filled.length} to save`}{" "}
                  · owner inherits the rock, dates optional
                </span>
              </div>

              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={r.key} className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-400">
                      {i + 1}
                    </span>
                    <input
                      autoFocus={r.key === focusKey}
                      value={r.title}
                      onChange={(e) =>
                        patchRow(r.key, { title: e.target.value })
                      }
                      placeholder={
                        i === 0
                          ? "First proof it's moving"
                          : i === 1
                            ? "Mid-quarter checkpoint"
                            : "What lands it"
                      }
                      className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <OwnerPicker
                      value={r.owner_id || inheritOwner}
                      valueName={ownerNameOf(r.owner_id || inheritOwner)}
                      onChange={(id) => patchRow(r.key, { owner_id: id })}
                      team={{
                        id: teamId,
                        name: teamName ?? "This team",
                        people: members,
                      }}
                      insideIds={insideIds}
                      orgPeople={orgPeople}
                      onNeedOrg={needOrg}
                      teamNameById={teamNameById}
                      className="w-[150px] shrink-0"
                    />
                    <LockToggle
                      value={r.locked || teamOnly}
                      disabled={!!lockReasonFor(r.owner_id || inheritOwner)}
                      disabledReason={lockReasonFor(r.owner_id || inheritOwner)}
                      onToggle={() => patchRow(r.key, { locked: !r.locked })}
                    />
                    <input
                      type="date"
                      value={r.due_date}
                      onChange={(e) =>
                        patchRow(r.key, { due_date: e.target.value })
                      }
                      aria-label="Milestone due date"
                      className="w-[126px] shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRows((rs) => rs.filter((x) => x.key !== r.key))
                      }
                      aria-label="Remove milestone"
                      className="shrink-0 rounded p-1 text-zinc-300 hover:text-red-600 dark:text-zinc-600"
                    >
                      <X className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const row = blankRow(inheritOwner);
                  setRows((rs) => [...rs, row]);
                  setFocusKey(row.key);
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-hpb-blue hover:border-hpb-blue hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-hpb-gold"
              >
                <Plus className="h-3 w-3" />
                Add milestone
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          <footer className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-200 px-6 py-3 dark:border-zinc-800">
            <span className="text-[11.5px] text-zinc-400">
              {filled.length
                ? `Saves the rock and ${filled.length} milestone${filled.length === 1 ? "" : "s"} together.`
                : ""}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={guard.requestClose}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-[13.5px] font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !title.trim() || !ownerId}
                className="rounded-md bg-hpb-blue px-3.5 py-1.5 text-[13.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {pending
                  ? editing
                    ? "Saving…"
                    : "Adding…"
                  : editing
                    ? "Save changes"
                    : "Add Rock"}
              </button>
            </div>
          </footer>
        </form>

        <SharingPane
          open={paneOpen}
          onClose={() => setPaneOpen(false)}
          parentTeamName={teamName ?? "This team"}
          shareTeams={shareTeams}
          sharedTeamIds={sharedTeamIds}
          teamOnly={teamOnly}
          reach={reach}
          milestones={filled.map((r) => ({
            key: r.key,
            title: r.title.trim(),
            ownerId: r.owner_id || inheritOwner,
            ownerName: ownerNameOf(r.owner_id || inheritOwner),
            locked: r.locked,
            lockReason: lockReasonFor(r.owner_id || inheritOwner),
          }))}
          onTeamsChange={setSharedTeamIds}
          onToggleLock={(key) =>
            setRows((rs) =>
              rs.map((r) => (r.key === key ? { ...r, locked: !r.locked } : r)),
            )
          }
        />

        <ShareConfirmDialog
          open={confirming}
          creating={!editing}
          parentTeamName={teamName ?? "This team"}
          changes={changes}
          lockedCount={lockedCount}
          teamName={(id) => teamNameById.get(id) ?? "A team"}
          pending={pending}
          onBack={() => setConfirming(false)}
          onConfirm={save}
        />

        <DiscardChangesDialog
          open={guard.asking}
          onKeepEditing={guard.keepEditing}
          onDiscard={guard.discard}
          message={
            editing
              ? "Your edits to this Rock haven't been saved. Close now and they're gone."
              : "This Rock hasn't been added yet. Close now and what you've typed — including its milestones — is gone."
          }
        />
    </ModalShell>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-400">
        {label}
        {required && <span className="text-red-600"> *</span>}
        {hint && <span className="font-normal text-zinc-400"> {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** The sharing-relevant slice of the draft, for `sharingChanges`. */
function sharingSnapshot(
  parentTeamId: string,
  teams: string[],
  rows: DraftMilestone[],
  teamOnly: boolean,
  inheritOwner: string,
  nameOf: (ownerId: string) => string,
  teamIdsOf: (ownerId: string) => string[],
): SharingSnapshot {
  return {
    parentTeamId,
    teamOnly,
    teams: [...teams],
    milestones: Object.fromEntries(
      rows
        .filter((r) => r.title.trim())
        .map((r) => {
          const owner = r.owner_id || inheritOwner;
          return [
            r.key,
            {
              title: r.title.trim(),
              locked: r.locked,
              ownerId: owner,
              ownerName: nameOf(owner),
              ownerTeamIds: teamIdsOf(owner),
            },
          ];
        }),
    ),
  };
}
