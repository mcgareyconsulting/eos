"use client";

// Admin-only controls for the Directory: the per-row menu (edit / revoke)
// and the header actions (add person / new team). Everything writes through
// app/(app)/admin/actions.ts and reports back through `onDone`, so the
// table owns the one success banner.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserX,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
  useDismissOnEscape,
} from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { DirectoryPerson } from "@/lib/firebase/directory";
import {
  addOrgPerson,
  createOrgTeam,
  deactivateOrgPerson,
  deleteOrgTeam,
  describeOrgTeam,
  reactivateOrgPerson,
  updateOrgPerson,
} from "../admin/actions";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import {
  describeLeftBehind,
  STRANDED_LIST_CAP,
  type TeamDataSummary,
} from "@/lib/firebase/team-delete";

type Team = { id: string; name: string };
type Result = { ok: true; message: string } | { ok: false; error: string };

/** Run a server action, surface its error inline, hand success upward. */
function useAdminAction(onDone: (message: string) => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<Result>, after: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        after();
        onDone(result.message);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }
  return { pending, error, setError, run };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {error}
    </p>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team checklist — shared by Add and Edit
// ---------------------------------------------------------------------------

/**
 * Which teams, and leader on which. Emits one hidden `team=<id>:<role>` per
 * checked team, which is what the server actions read. Leader is only
 * offered once the team is checked, so the two controls can't disagree.
 */
function TeamChecklist({
  teams,
  initial,
}: {
  teams: Team[];
  initial: Map<string, "leader" | "member">;
}) {
  const [picked, setPicked] = useState(initial);

  function toggleTeam(id: string) {
    const next = new Map(picked);
    if (next.has(id)) next.delete(id);
    else next.set(id, "member");
    setPicked(next);
  }
  function toggleLeader(id: string) {
    const next = new Map(picked);
    next.set(id, next.get(id) === "leader" ? "member" : "leader");
    setPicked(next);
  }

  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Teams
      </legend>
      {teams.length === 0 ? (
        <p className="text-sm text-zinc-500">No teams yet.</p>
      ) : (
        <ul className="max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
          {teams.map((t) => {
            const role = picked.get(t.id);
            const on = role !== undefined;
            return (
              <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleTeam(t.id)}
                    className="h-4 w-4 accent-hpb-blue dark:accent-hpb-gold"
                  />
                  <span className="truncate">{t.name}</span>
                </label>
                <label
                  className={cn(
                    "flex shrink-0 items-center gap-1 text-xs",
                    on ? "cursor-pointer text-zinc-600 dark:text-zinc-400" : "invisible",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={role === "leader"}
                    onChange={() => toggleLeader(t.id)}
                    disabled={!on}
                    className="h-3.5 w-3.5 accent-hpb-blue dark:accent-hpb-gold"
                  />
                  Leader
                </label>
                {on && <input type="hidden" name="team" value={`${t.id}:${role}`} />}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

function OrgAdminToggle({ defaultChecked, disabled }: { defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        name="org_admin"
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 accent-hpb-blue dark:accent-hpb-gold"
      />
      <span>
        <span className="font-medium">Org admin</span>
        <span className="block text-xs text-zinc-500">
          Can manage every team and everyone in this directory.
        </span>
      </span>
    </label>
  );
}

function FeedbackTrackerToggle({
  defaultChecked,
  disabled,
  viaAdmin,
}: {
  defaultChecked: boolean;
  disabled?: boolean;
  /** An org admin has the tracker already; the switch only shows it. */
  viaAdmin?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        name="feedback_tracker"
        defaultChecked={viaAdmin || defaultChecked}
        disabled={viaAdmin || disabled}
        className="mt-0.5 h-4 w-4 accent-hpb-blue dark:accent-hpb-gold"
      />
      <span>
        <span className="font-medium">Feedback tracker</span>
        <span className="block text-xs text-zinc-500">
          {viaAdmin
            ? "Included with org admin."
            : "Can open the feedback tracker and see, edit and log every item. Org admins have it already."}
        </span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Per-row menu
// ---------------------------------------------------------------------------

export function PersonRowMenu({
  person,
  teams,
  isSelf,
  onDone,
}: {
  person: DirectoryPerson;
  teams: Team[];
  isSelf: boolean;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useDismissOnEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const name = `${person.firstName} ${person.lastName}`.trim() || person.email || "this person";
  const reactivate = useAdminAction(onDone);
  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800";

  return (
    <div ref={wrapRef} className="relative flex justify-end">
      <IconButton
        muted
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </IconButton>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {person.deactivated ? (
            <button
              type="button"
              role="menuitem"
              disabled={reactivate.pending}
              className={itemClass}
              onClick={() => {
                setOpen(false);
                reactivate.run(() => reactivateOrgPerson(person.uid), () => {});
              }}
            >
              <Pencil className="h-4 w-4 text-zinc-500" aria-hidden />
              Reactivate
            </button>
          ) : (
          <>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4 text-zinc-500" aria-hidden />
            Edit teams &amp; access
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isSelf}
            title={isSelf ? "You can't deactivate your own account" : undefined}
            className={`${itemClass} border-t border-zinc-200 text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-red-400`}
            onClick={() => {
              setOpen(false);
              setRevoking(true);
            }}
          >
            <UserX className="h-4 w-4" aria-hidden />
            Deactivate
          </button>
          </>
          )}
        </div>
      )}

      {/* Mounted per open so each opening starts from the person's current
          teams rather than the last edit's draft. Siblings of the menu, not
          children — the menu closes in the same tick they open. */}
      {editing && (
        <EditPersonModal
          person={person}
          teams={teams}
          isSelf={isSelf}
          onClose={() => setEditing(false)}
          onDone={onDone}
        />
      )}
      {revoking && (
        <RevokeAccessModal
          person={person}
          onClose={() => setRevoking(false)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function EditPersonModal({
  person,
  teams,
  isSelf,
  onClose,
  onDone,
}: {
  person: DirectoryPerson;
  teams: Team[];
  isSelf: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { pending, error, run } = useAdminAction(onDone);
  const name = `${person.firstName} ${person.lastName}`.trim() || person.email || "";
  const initial = new Map(
    person.teams.map((t) => [t.id, t.role === "leader" ? "leader" : "member"] as const),
  );

  return (
    <ModalShell open onClose={onClose} ariaLabel={`Edit ${name}`} size="md" portal>
      <ModalHeader title={name} onClose={onClose} />
      <form action={(fd) => run(() => updateOrgPerson(person.uid, fd), onClose)}>
        <ModalBody className="space-y-4">
          <p className="text-xs text-zinc-500">{person.email ?? "No email on file"}</p>
          <TeamChecklist teams={teams} initial={initial} />
          <OrgAdminToggle
            defaultChecked={person.access === "admin"}
            // Nobody removes their own admin: the server refuses it too.
            disabled={isSelf}
          />
          <FeedbackTrackerToggle
            defaultChecked={person.feedbackAccess === true}
            // Access is keyed by sign-in email.
            disabled={!person.email}
            viaAdmin={person.access === "admin"}
          />
          {/* Sent so the server can tell "unchecked" from "not shown". An
              admin's switch is display-only, so their list entry is left as is. */}
          {person.access !== "admin" && <input type="hidden" name="feedback_tracker_shown" value="1" />}
          {person.hasAuth === false && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              No sign-in account yet, so org admin can&rsquo;t be granted until
              they are added with an email.
            </p>
          )}
          <ErrorLine error={error} />
        </ModalBody>
        <ModalFooter className="px-4 pb-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

function RevokeAccessModal({
  person,
  onClose,
  onDone,
}: {
  person: DirectoryPerson;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { pending, error, run } = useAdminAction(onDone);
  const name = `${person.firstName} ${person.lastName}`.trim() || person.email || "this person";
  const n = person.teams.length;

  return (
    <ModalShell open onClose={onClose} ariaLabel="Deactivate" size="md" portal>
      <ModalHeader title={`Deactivate ${name}?`} onClose={onClose} />
      <ModalBody>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          They are removed from{" "}
          <strong>
            {n} team{n === 1 ? "" : "s"}
          </strong>{" "}
          and can no longer sign in. An admin can reactivate them later.
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Their <strong>rocks, milestones, to-dos, issues, metrics and headlines
          become unassigned</strong>, and the leaders of each team are told.
          Someone on the team must assign them to a new owner.
        </p>
        {person.access === "admin" && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
            This person is an org admin. Deactivating removes that access too.
          </p>
        )}
        <div className="mt-3">
          <ErrorLine error={error} />
        </div>
      </ModalBody>
      <ModalFooter className="px-4 pb-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          autoFocus
          disabled={pending}
          className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
          onClick={() =>
            run(
              () =>
                deactivateOrgPerson(person.uid).then((r) =>
                  r.ok ? { ok: true, message: `${name}: ${r.message}` } : r,
                ),
              onClose,
            )
          }
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Deactivate
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------

export function AddPersonButton({
  teams,
  onDone,
}: {
  teams: Team[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add person
      </Button>
      {open && (
        <AddPersonModal teams={teams} onClose={() => setOpen(false)} onDone={onDone} />
      )}
    </>
  );
}

function AddPersonModal({
  teams,
  onClose,
  onDone,
}: {
  teams: Team[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { pending, error, run } = useAdminAction(onDone);
  return (
    <ModalShell open onClose={onClose} ariaLabel="Add person" size="md" portal>
      <ModalHeader title="Add person" onClose={onClose} />
      <form action={(fd) => run(() => addOrgPerson(fd), onClose)}>
        <ModalBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor="add-first">
              <Input id="add-first" name="first_name" required autoFocus />
            </Field>
            <Field label="Last name" htmlFor="add-last">
              <Input id="add-last" name="last_name" required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email" htmlFor="add-email">
                <Input id="add-email" name="email" type="email" required />
              </Field>
            </div>
          </div>
          <TeamChecklist teams={teams} initial={new Map()} />
          <OrgAdminToggle defaultChecked={false} />
          <p className="text-xs text-zinc-500">
            No email is sent. This creates an empty account that activates
            when they first sign in with Google.
          </p>
          <ErrorLine error={error} />
        </ModalBody>
        <ModalFooter className="px-4 pb-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add person
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

export function NewTeamButton({
  people,
  onDone,
}: {
  people: DirectoryPerson[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New team
      </Button>
      {open && (
        <NewTeamModal people={people} onClose={() => setOpen(false)} onDone={onDone} />
      )}
    </>
  );
}

function NewTeamModal({
  people,
  onClose,
  onDone,
}: {
  people: DirectoryPerson[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { pending, error, run } = useAdminAction(onDone);
  return (
    <ModalShell open onClose={onClose} ariaLabel="New team" size="md" portal>
      <ModalHeader title="New team" onClose={onClose} />
      <form action={(fd) => run(() => createOrgTeam(fd), onClose)}>
        <ModalBody className="space-y-4">
          <Field label="Team name" htmlFor="team-name">
            <Input id="team-name" name="name" required autoFocus />
          </Field>
          <Field label="Leader (optional)" htmlFor="team-leader">
            <Select id="team-leader" name="leader_uid" defaultValue="">
              <option value="">No leader yet</option>
              {people.map((p) => (
                <option key={p.uid} value={p.uid}>
                  {`${p.firstName} ${p.lastName}`.trim() || p.email || p.uid}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-zinc-500">
            Anyone else joins through their row in the Directory.
          </p>
          <ErrorLine error={error} />
        </ModalBody>
        <ModalFooter className="px-4 pb-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create team
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Delete team
// ---------------------------------------------------------------------------

/**
 * Admin-only. Deletes the team's name and its roster; the team's data stays
 * in the database under the old id (lib/firebase/team-delete.ts). The dialog
 * shows what is left behind and has the admin type the team's name.
 */
export function DeleteTeamButton({
  teams,
  onDone,
}: {
  teams: Team[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (teams.length === 0) return null;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <Trash2 className="h-4 w-4" />
        Delete team
      </Button>
      {open && <DeleteTeamModal teams={teams} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function DeleteTeamModal({
  teams,
  onClose,
  onDone,
}: {
  teams: Team[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { pending, error, setError, run } = useAdminAction(onDone);
  const sorted = [...teams].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const [teamId, setTeamId] = useState(sorted[0].id);
  const [typed, setTyped] = useState("");
  // What each pick holds, fetched once per team: the dialog must say what
  // it is about to orphan before the button is live. Keyed by team so a
  // switch back needs no refetch and no state reset.
  const [summaries, setSummaries] = useState<Record<string, TeamDataSummary | null>>({});
  const summary: TeamDataSummary | null | "loading" =
    teamId in summaries ? summaries[teamId] : "loading";
  const team = sorted.find((t) => t.id === teamId) ?? sorted[0];
  const options: SelectOption[] = sorted.map((t) => ({ value: t.id, label: t.name }));

  useEffect(() => {
    if (teamId in summaries) return;
    let cancelled = false;
    describeOrgTeam(teamId)
      .then((s) => {
        if (!cancelled) setSummaries((prev) => ({ ...prev, [teamId]: s }));
      })
      .catch(() => {
        if (!cancelled) setSummaries((prev) => ({ ...prev, [teamId]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, summaries]);

  const confirmed = typed.trim() === team.name.trim();
  const leftBehind =
    summary && summary !== "loading" ? describeLeftBehind(summary.data) : "";

  return (
    <ModalShell open onClose={onClose} ariaLabel="Delete team" size="lg" portal>
      <ModalHeader title="Delete team" onClose={onClose} />
      <ModalBody className="space-y-4">
        {sorted.length > 1 && (
          <Field label="Team" htmlFor="delete-team-which">
            <SelectMenu
              id="delete-team-which"
              options={options}
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                setTyped("");
                setError(null);
              }}
            />
          </Field>
        )}

        {summary === "loading" ? (
          <p className="text-sm text-zinc-500">Checking what {team.name} holds…</p>
        ) : summary === null ? (
          <p className="text-sm text-zinc-500">This team no longer exists.</p>
        ) : (
          <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            <p>
              <strong>{summary.name}</strong> is removed from every sidebar and
              team switcher, and its{" "}
              <strong>
                {summary.memberCount} member{summary.memberCount === 1 ? "" : "s"}
              </strong>{" "}
              {summary.memberCount === 1 ? "loses" : "lose"} the team. People keep
              their accounts and their other teams.
            </p>
            {leftBehind ? (
              <StrandedRecordsWarning summary={summary} leftBehind={leftBehind} />
            ) : (
              <p className="text-zinc-500">The team holds no rocks, to-dos, issues, headlines, measurables or meetings.</p>
            )}
            <p>This can&rsquo;t be undone.</p>
          </div>
        )}

        <Field label={`Type the team name (${team.name}) to confirm`} htmlFor="delete-team-confirm">
          <Input
            id="delete-team-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            placeholder={team.name}
          />
        </Field>
        <ErrorLine error={error} />
      </ModalBody>
      <ModalFooter className="px-4 pb-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={pending || !confirmed || summary === "loading" || summary === null}
          className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
          onClick={() => run(() => deleteOrgTeam(teamId), onClose)}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Delete team
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

/**
 * The warning that names what deleting the team strands: every rock,
 * to-do, issue, headline, measurable and meeting still filed under it, by
 * title, open work first. Counts come from the full query; the list shows
 * the first STRANDED_LIST_CAP per kind and says how many more there are.
 */
function StrandedRecordsWarning({
  summary,
  leftBehind,
}: {
  summary: TeamDataSummary;
  leftBehind: string;
}) {
  const kinds = summary.data.filter((d) => d.count > 0);
  const total = kinds.reduce((n, d) => n + d.count, 0);
  return (
    <div
      role="alert"
      className="rounded-md bg-amber-50 px-3 py-2.5 text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900"
    >
      <p className="flex items-start gap-2 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>
            {total} record{total === 1 ? "" : "s"} will be stranded
          </strong>{" "}
          ({leftBehind}). They are <strong>not</strong> deleted: they stay in the
          database under this team and nobody can reach them in the app
          afterwards. Reassign or archive anything still needed first.
        </span>
      </p>
      <div className="mt-2 max-h-56 space-y-2.5 overflow-y-auto rounded-md bg-white/70 px-3 py-2 dark:bg-zinc-950/40">
        {kinds.map((d) => (
          <section key={d.collection}>
            <h4 className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-amber-800 dark:text-amber-300">
              {d.count} {d.label}
            </h4>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-zinc-800 dark:text-zinc-200">
              {d.records.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate" title={r.label}>
                    {r.label}
                  </span>
                  {r.note && (
                    <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {r.note}
                    </span>
                  )}
                </li>
              ))}
              {d.count > d.records.length && (
                <li className="text-[11.5px] italic text-zinc-500 dark:text-zinc-400">
                  and {d.count - d.records.length} more (showing the first {STRANDED_LIST_CAP})
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
