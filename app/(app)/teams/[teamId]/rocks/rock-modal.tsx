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
} from "@/components/ui/owner-picker";
import { initialRockOwner, rockOwnerChoices } from "./rock-owner";
import {
  AudiencePane,
  AudienceSummary,
  ShareConfirmDialog,
  type HeadlinePerson,
} from "./rock-sharing";
import {
  audienceRemovals,
  sharingChanges,
  sharingPicture,
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
import {
  MilestoneExpansion,
  useExpandedMilestones,
  useMilestoneDrafts,
} from "./milestone-expansion";
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
  /** "" = the rock owner (the default assignee, spec §3.3). */
  owner_id: string;
  due_date: string;
  /** Rich text, "" = none. Saved with the rock like the other fields. */
  description: string;
  /** Stored with no owner (a deactivation, spec §2.6) and not touched since:
   *  saves as unassigned. Editing the row assigns it to the rock owner. */
  unassigned?: boolean;
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
  /** Effective audience (lib/access/rock.ts), legacy names folded in. */
  audience_team_ids?: string[] | null;
  audience_user_ids?: string[] | null;
  private?: boolean | null;
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
function fetchOrgPeople(): Promise<OrgPerson[]> {
  orgPeopleCache ??= loadOrgPeople().catch((err) => {
    orgPeopleCache = null;
    throw err;
  });
  return orgPeopleCache;
}

let draftSeq = 0;
function blankRow(): DraftMilestone {
  draftSeq += 1;
  return {
    key: `draft-${draftSeq}`,
    title: "",
    owner_id: "",
    due_date: "",
    description: "",
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
      .map((r) => [r.id ?? "", r.title, r.owner_id, r.due_date, r.description]),
  );
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
  canManageAudience = false,
}: {
  teamId: string;
  members: Member[];
  quarter: string;
  defaultDue: string;
  currentUserId: string;
  teamName?: string;
  shareTeams?: ShareTeam[];
  canFlagCompany?: boolean;
  canManageAudience?: boolean;
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
          canManageAudience={canManageAudience}
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
  canManageAudience = false,
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
  canManageAudience?: boolean;
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
          canManageAudience={canManageAudience}
          rock={rock}
          milestones={milestones}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Create/edit: parent team (context), rock kind, person owner (on the parent
 * team), audience (leaders/admins), rich description, milestones.
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
  canManageAudience = false,
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
  /**
   * Leader of the parent team or admin (rockAccess.canChangeAudience): may
   * change the audience and Private. Everyone else sees them read-only; the
   * server preserves the stored values on their save regardless.
   */
  canManageAudience?: boolean;
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
  const initialOwner = initialRockOwner(
    rock?.owner_id,
    currentUserId,
    new Set(members.map((m) => m.user_id)),
  );
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
  const [audienceTeamIds, setAudienceTeamIds] = useState<string[]>(() =>
    (rock?.audience_team_ids ?? []).filter((id) => id && id !== teamId),
  );
  const [audienceUserIds, setAudienceUserIds] = useState<string[]>(
    () => rock?.audience_user_ids ?? [],
  );
  const [isPrivate, setIsPrivate] = useState(rock?.private === true);
  const [orgPeople, setOrgPeople] = useState<OrgPerson[] | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [changes, setChanges] = useState<SharingChange[]>([]);
  // The review lists everyone the saved rock reaches, not just the change.
  const [picture, setPicture] = useState<SharingChange[]>([]);
  const [removed, setRemoved] = useState<{ teamIds: string[]; userIds: string[] }>({
    teamIds: [],
    userIds: [],
  });
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
          owner_id: m.owner_id ?? "",
          due_date: m.due_date ?? "",
          description: m.description ?? "",
          unassigned: !m.owner_id,
        }))
      : [blankRow(), blankRow(), blankRow()];
    return focusMilestones ? [...base, blankRow()] : base;
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
    audience: [isPrivate, ...audienceTeamIds, "|", ...audienceUserIds].join(","),
    qtr,
    due,
    milestones: serializeRows(rows),
  }));
  // The sharing baseline is kept raw and turned into a snapshot at save
  // time, with the same owner→teams lookup as the draft: the org list that
  // lookup needs is still loading at mount, and a baseline built then would
  // report every existing assignment as new.
  const [openedSharing] = useState(() => ({
    teams: audienceTeamIds,
    users: audienceUserIds,
    rows,
    isPrivate,
  }));

  // A milestone's name area expands it: its description editor and, once it
  // exists, its activity feed. A comment typed there and not yet posted
  // counts as unsaved work too (the same guard, its own message).
  const expand = useExpandedMilestones();
  const commentDrafts = useMilestoneDrafts();

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const formDirty = draftChanged(
      {
        title,
        description,
        ownerId,
        rockType,
        companyRock,
        audience: [isPrivate, ...audienceTeamIds, "|", ...audienceUserIds].join(","),
        qtr,
        due,
        milestones: serializeRows(rows),
      },
      opened,
    );
  const guard = useDiscardGuard(formDirty || commentDrafts.hasDraft, onClose);

  const filled = rows.filter((r) => r.title.trim());

  // Touching an unassigned row assigns it (no new or changed milestone is
  // saved without an owner, spec §2.6).
  function patchRow(key: string, patch: Partial<DraftMilestone>) {
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, ...patch, unassigned: false } : r)),
    );
  }
  /** The assignee a row saves with: its pick, else the rock owner. */
  const ownerOf = (r: DraftMilestone): string | null =>
    r.owner_id || (r.unassigned ? null : inheritOwner);

  const shareTeamName = new Map(shareTeams.map((t) => [t.id, t.name]));
  const teamNameById = new Map(shareTeamName);
  teamNameById.set(teamId, teamName ?? "This team");
  const nameById = new Map<string, string>();
  for (const p of orgPeople ?? []) nameById.set(p.user_id, p.full_name);
  for (const p of members) nameById.set(p.user_id, p.full_name);
  const ownerNameOf = (id: string) =>
    nameById.get(id) ?? labelById.get(id) ?? "Current owner";
  const parentIds = new Set(members.map((m) => m.user_id));
  const ownerChoices = rockOwnerChoices(
    members,
    rock?.owner_id,
    rock?.owner_id ? ownerNameOf(rock.owner_id) : "",
  );
  // An owner's teams, from the org list (prefetched on open). Before it
  // arrives, only "on this team" is known.
  const teamIdsOf = (id: string): string[] =>
    orgPeople?.find((p) => p.user_id === id)?.team_ids ??
    (parentIds.has(id) ? [teamId] : []);
  const teamNamesOf = (id: string) =>
    teamIdsOf(id)
      .map((t) => teamNameById.get(t) ?? "Team")
      .join(", ");
  const personNameOf = (id: string) => nameById.get(id) ?? "Someone";
  const snapshotOf = (
    teams: string[],
    users: string[],
    rs: DraftMilestone[],
    priv: boolean,
  ): SharingSnapshot => ({
    parentTeamId: teamId,
    private: priv,
    audienceTeamIds: priv ? [] : [...teams],
    audienceUserIds: priv ? [] : [...users],
    milestones: Object.fromEntries(
      rs
        .filter((r) => r.title.trim())
        .map((r) => {
          const owner = ownerOf(r);
          return [
            r.key,
            {
              title: r.title.trim(),
              ownerId: owner,
              ownerName: owner ? ownerNameOf(owner) : "Unassigned",
              ownerTeamIds: owner ? teamIdsOf(owner) : [],
            },
          ];
        }),
    ),
  });

  // Prefetch on open (see orgPeopleCache). The picker's own request is the
  // retry path if this one failed.
  useEffect(() => {
    let cancelled = false;
    fetchOrgPeople()
      .then((people) => {
        if (!cancelled) setOrgPeople(people);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Who sees the whole rock: the parent team, the audience teams and the
  // audience persons. An assignee outside that set sees only their
  // milestone(s) and the rock's title (lib/access/rock.ts). Only known once
  // the org list has loaded — nothing shows until then rather than guessing.
  const fullTeams = new Set([teamId, ...(isPrivate ? [] : audienceTeamIds)]);
  const fullUsers = new Set(isPrivate ? [] : audienceUserIds);
  const seesWhole = (id: string) =>
    parentIds.has(id) ||
    fullUsers.has(id) ||
    teamIdsOf(id).some((t) => fullTeams.has(t));
  const headlinePeople: HeadlinePerson[] = [];
  if (orgPeople) {
    const byOwner = new Map<string, string[]>();
    for (const r of filled) {
      const owner = ownerOf(r);
      if (!owner || seesWhole(owner)) continue;
      const list = byOwner.get(owner) ?? [];
      list.push(r.title.trim());
      byOwner.set(owner, list);
    }
    for (const [id, titles] of byOwner) {
      headlinePeople.push({ id, name: ownerNameOf(id), teams: teamNamesOf(id), titles });
    }
  }
  // Everyone who sees the whole rock — only for the picker's "sees only
  // their milestone" dot, and only once known.
  const insideIds = orgPeople
    ? new Set(orgPeople.filter((p) => seesWhole(p.user_id)).map((p) => p.user_id))
    : undefined;

  function setPrivate(on: boolean) {
    setIsPrivate(on);
    // Private has no audience (spec §3.3): the switch clears it.
    if (on) {
      setAudienceTeamIds([]);
      setAudienceUserIds([]);
    }
  }

  function needOrg() {
    if (orgPeople) return;
    fetchOrgPeople()
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
    if (isPrivate) {
      const outside = filled.find((r) => {
        const owner = ownerOf(r);
        return owner && !parentIds.has(owner);
      });
      if (outside) {
        const owner = ownerOf(outside) as string;
        setError(
          `${ownerNameOf(owner)} is not on this team; private rocks can't have outside assignees. Reassign “${outside.title.trim()}” first.`,
        );
        return;
      }
    }
    const before = snapshotOf(
      openedSharing.teams,
      openedSharing.users,
      openedSharing.rows,
      openedSharing.isPrivate,
    );
    const after = snapshotOf(audienceTeamIds, audienceUserIds, rows, isPrivate);
    const changed = sharingChanges(before, after);
    // Adding always reviews who will see the rock; editing only when the
    // save changes it (see ShareConfirmDialog).
    if (!editing || changed.length > 0) {
      setChanges(changed);
      setPicture(sharingPicture(after));
      setRemoved(audienceRemovals(before, after));
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
    // Leaders/admins only — the server keeps the stored values otherwise.
    fd.set("audience_team_ids", JSON.stringify(isPrivate ? [] : audienceTeamIds));
    fd.set("audience_user_ids", JSON.stringify(isPrivate ? [] : audienceUserIds));
    fd.set("private", isPrivate ? "true" : "false");
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
          // "" = the rock owner, or unassigned for an untouched row
          // stored without one (updateRockWithMilestones decides).
          owner_id: r.owner_id,
          due_date: r.due_date || null,
          description: r.description,
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
      // Escape belongs to whichever dialog is stacked on top — and not to
      // this one when something inside claimed it (a milestone's comment
      // composer folds itself away on Escape).
      dismissible={!guard.asking && !paneOpen && !confirming}
      escape="topmost"
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
                {/* Team tab only: the server takes a rock owner from the
                    parent roster, or keeps the one it has (rock-owner.ts). */}
                <OwnerPicker
                  variant="field"
                  label="Owner"
                  teamOnly
                  value={ownerId}
                  valueName={
                    ownerChoices.find((p) => p.user_id === ownerId)
                      ?.full_name ??
                    (ownerId ? ownerNameOf(ownerId) : "Choose owner")
                  }
                  onChange={setOwnerId}
                  team={{
                    id: teamId,
                    name: teamName ?? "This team",
                    people: ownerChoices,
                  }}
                  orgPeople={orgPeople}
                  onNeedOrg={needOrg}
                  teamNameById={teamNameById}
                  className="h-auto text-[13.5px] dark:bg-zinc-900"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Accountable person on this team — even for team rocks.
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

            <AudienceSummary
              parentTeamName={teamName ?? "This team"}
              audienceTeams={audienceTeamIds.map((id) => ({
                id,
                name: shareTeamName.get(id) ?? "Unknown team",
              }))}
              audiencePeople={audienceUserIds.map((id) => ({
                id,
                name: personNameOf(id),
              }))}
              headlinePeople={headlinePeople}
              isPrivate={isPrivate}
              canManage={canManageAudience}
              onPrivateChange={setPrivate}
              onManage={() => {
                needOrg();
                setPaneOpen(true);
              }}
            />

            <div className="border-t border-zinc-200 pt-3.5 dark:border-zinc-800">
              <div className="mb-2">
                <span className="text-[13px] font-semibold">Milestones</span>{" "}
                <span className="text-[11.5px] text-zinc-400">
                  {filled.length === 0
                    ? "none yet"
                    : `${filled.length} to save`}{" "}
                  · assignee defaults to the rock owner, dates optional
                </span>
              </div>

              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={r.key}>
                    <div className="flex items-center gap-1.5">
                      {/* The title is an input (click = type), so the number
                          beside it is the expand toggle. */}
                      <button
                        type="button"
                        onClick={() => expand.toggle(r.key)}
                        aria-expanded={expand.isOpen(r.key)}
                        aria-label={`${expand.isOpen(r.key) ? "Hide" : "Show"} details for milestone ${i + 1}`}
                        title="Description and activity"
                        className="flex shrink-0 items-center gap-0.5 rounded px-0.5 py-1 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 dark:hover:bg-zinc-800"
                      >
                        <span
                          className={cn(
                            "w-4 text-right text-[11px] font-semibold tabular-nums",
                            r.description.trim()
                              ? "text-hpb-blue dark:text-hpb-gold"
                              : "text-zinc-400",
                          )}
                        >
                          {i + 1}
                        </span>
                      </button>
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
                        value={ownerOf(r) ?? ""}
                        valueName={(() => {
                          const owner = ownerOf(r);
                          return owner ? ownerNameOf(owner) : "Unassigned";
                        })()}
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
                    <MilestoneExpansion
                      open={expand.isOpen(r.key)}
                      draftKey={r.key}
                      teamId={teamId}
                      userId={currentUserId}
                      members={members}
                      milestoneId={r.id}
                      onDraft={commentDrafts.report}
                      className="mb-2 ml-[29px] mr-7 mt-1.5 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/30"
                      descriptionEditor={
                        <RichTextEditor
                          value={r.description}
                          onChange={(next) =>
                            patchRow(r.key, { description: next })
                          }
                          placeholder="Notes or context"
                          rows={3}
                        />
                      }
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const row = blankRow();
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

        <AudiencePane
          open={paneOpen}
          onClose={() => setPaneOpen(false)}
          parentTeamName={teamName ?? "This team"}
          teamOptions={shareTeams}
          personOptions={
            orgPeople
              ? orgPeople.map((p) => ({ id: p.user_id, name: p.full_name }))
              : null
          }
          audienceTeamIds={audienceTeamIds}
          audienceUserIds={audienceUserIds}
          isPrivate={isPrivate}
          canManage={canManageAudience}
          headlinePeople={headlinePeople}
          onTeamsChange={setAudienceTeamIds}
          onUsersChange={setAudienceUserIds}
        />

        <ShareConfirmDialog
          open={confirming}
          creating={!editing}
          parentTeamName={teamName ?? "This team"}
          changes={changes}
          picture={picture}
          removed={removed}
          teamName={(id) => teamNameById.get(id) ?? "A team"}
          personName={personNameOf}
          pending={pending}
          onBack={() => setConfirming(false)}
          onConfirm={save}
        />

        <DiscardChangesDialog
          open={guard.asking}
          onKeepEditing={guard.keepEditing}
          onDiscard={guard.discard}
          message={
            !formDirty
              ? "You have a milestone comment you haven't posted. Close now and it's gone."
              : editing
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
