"use client";

import { useState, useTransition } from "react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  createRockWithMilestones,
  updateRockWithMilestones,
} from "./actions";
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

/**
 * Create/edit chooser — team vs individual (person owner is separate).
 * The kinds themselves come from rock-type.ts so the badge dropdown and this
 * modal can't drift; only the explanatory hints live here.
 */
const KIND_HINTS: Record<string, string> = {
  individual: "Personal priority — lists under the owner",
  department: "Team priority — Department section; still needs an owner",
};

type DraftMilestone = {
  /** React key; also the todo doc id when this row already exists. */
  key: string;
  id?: string;
  title: string;
  owner_id: string;
  due_date: string;
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
};

let draftSeq = 0;
function blankRow(ownerId: string): DraftMilestone {
  draftSeq += 1;
  return { key: `draft-${draftSeq}`, title: "", owner_id: ownerId, due_date: "" };
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
      .map((r) => [r.id ?? "", r.title, r.owner_id, r.due_date]),
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
 * Create/edit: home team (context), rock kind, person owner, optional share,
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
    qtr,
    due,
    milestones: serializeRows(rows),
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

  function toggleShareTeam(id: string) {
    setSharedTeamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
    const fd = new FormData();
    fd.set("title", title);
    fd.set("description", description);
    fd.set("owner_id", ownerId);
    fd.set("rock_type", rockType);
    fd.set("is_company_rock", companyRock ? "true" : "false");
    fd.set("shared_team_ids", JSON.stringify(sharedTeamIds));
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
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <ModalShell
      open
      onClose={guard.requestClose}
      // Escape belongs to the discard confirm while it is up.
      dismissible={!guard.asking}
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
                  · home team
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
              <div
                role="radiogroup"
                aria-label="Rock kind"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
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
                        "rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
                        selected
                          ? "border-hpb-blue bg-hpb-blue/[0.07] ring-1 ring-hpb-blue dark:bg-hpb-blue/15"
                          : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500",
                      )}
                    >
                      <div
                        className={cn(
                          "text-[13.5px] font-bold",
                          selected
                            ? "text-hpb-blue dark:text-hpb-gold"
                            : "text-zinc-800 dark:text-zinc-100",
                        )}
                      >
                        {opt.label}
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                        {KIND_HINTS[opt.value]}
                      </p>
                    </button>
                  );
                })}
              </div>
              {canFlagCompany ? (
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-hpb-blue/30 bg-hpb-blue/[0.04] px-3 py-2 dark:bg-hpb-blue/10">
                  <input
                    type="checkbox"
                    checked={companyRock}
                    onChange={(e) => setCompanyRock(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-hpb-blue"
                  />
                  <span>
                    <span className="block text-[13px] font-bold text-hpb-blue dark:text-white">
                      Company Rock
                    </span>
                    <span className="block text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                      Company-level priority — leads the list ahead of the
                      Department section. Independent of the kind above; a
                      Team rock can be a Company rock too. Admins only.
                    </span>
                  </span>
                </label>
              ) : companyRock ? (
                <p className="mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                  Flagged as a <span className="font-bold text-hpb-blue dark:text-hpb-gold">Company Rock</span> by an
                  admin — saving keeps that flag.
                </p>
              ) : null}
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
              <Field
                label="Share with teams"
                hint="(optional — same rock on other teams' lists)"
              >
                <div className="flex flex-wrap gap-1.5 rounded-md border border-zinc-200 bg-zinc-50/80 p-2 dark:border-zinc-800 dark:bg-zinc-800/40">
                  {shareTeams.map((t) => {
                    const on = sharedTeamIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleShareTeam(t.id)}
                        aria-pressed={on}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset transition-colors",
                          on
                            ? "bg-hpb-blue text-white ring-hpb-blue"
                            : "bg-white text-zinc-600 ring-zinc-300 hover:ring-hpb-blue/50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700",
                        )}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Home team stays {teamName ?? "this team"}. Sharing is
                  team-to-team, not person-to-person.
                </p>
              </Field>
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
                    <select
                      value={r.owner_id || inheritOwner}
                      onChange={(e) =>
                        patchRow(r.key, { owner_id: e.target.value })
                      }
                      aria-label="Milestone owner"
                      className="w-[130px] shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
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
