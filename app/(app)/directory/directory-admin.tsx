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
  deleteOrgPerson,
  updateOrgPerson,
} from "../admin/actions";

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
            title={isSelf ? "You can't revoke your own access" : undefined}
            className={`${itemClass} border-t border-zinc-200 text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-red-400`}
            onClick={() => {
              setOpen(false);
              setRevoking(true);
            }}
          >
            <UserX className="h-4 w-4" aria-hidden />
            Revoke access
          </button>
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
          {!person.hasAuth && (
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
    <ModalShell open onClose={onClose} ariaLabel="Revoke access" size="md" portal>
      <ModalHeader title={`Revoke ${name}'s access?`} onClose={onClose} />
      <ModalBody>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          They are removed from{" "}
          <strong>
            {n} team{n === 1 ? "" : "s"}
          </strong>{" "}
          and can no longer sign in.
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Their <strong>rocks, to-dos, issues and headlines stay where they are</strong>,
          still showing their name — nothing they owned is deleted or
          unassigned. Reassign that work first if someone needs to pick it up.
        </p>
        {person.access === "admin" && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
            This person is an org admin. Revoking removes that access too.
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
                deleteOrgPerson(person.uid).then((r) =>
                  r.ok ? { ok: true, message: `${name}: ${r.message}` } : r,
                ),
              onClose,
            )
          }
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Revoke access
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
