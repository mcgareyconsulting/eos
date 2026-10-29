"use client";

// Leader-only roster controls for the Directory (spec 2.2): add an existing
// directory person to a team the viewer leads, remove a person from one. No
// accounts are created and roles are not changed here; both are admin-only.
// Renaming a team is leader-or-admin, so admins get that button too.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Pencil, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
} from "@/components/ui/modal";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import type { DirectoryPerson } from "@/lib/firebase/directory";
import { addTeamMember, removeTeamMember } from "./roster-actions";
import { renameTeam } from "./team-actions";

type Team = { id: string; name: string };

export function LeaderAddButton({
  ledTeams,
  people,
  onDone,
}: {
  ledTeams: Team[];
  people: DirectoryPerson[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (ledTeams.length === 0) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Add to my team
      </Button>
      {open && (
        <AddToTeamModal
          ledTeams={ledTeams}
          people={people}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function AddToTeamModal({
  ledTeams,
  people,
  onClose,
  onDone,
}: {
  ledTeams: Team[];
  people: DirectoryPerson[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState(ledTeams[0].id);
  const [uid, setUid] = useState("");

  const teamOptions: SelectOption[] = ledTeams.map((t) => ({ value: t.id, label: t.name }));
  const personOptions: SelectOption[] = people
    .filter((p) => !p.teams.some((t) => t.id === teamId))
    .sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
    )
    .map((p) => ({
      value: p.uid,
      label: `${p.firstName} ${p.lastName}`.trim() || p.email || p.uid,
      description: p.email ?? undefined,
    }));

  function submit() {
    if (!uid) {
      setError("Choose a person");
      return;
    }
    setError(null);
    start(async () => {
      const result = await addTeamMember(teamId, uid);
      if (result.ok) {
        onDone(result.message);
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <ModalShell open onClose={onClose} ariaLabel="Add to team" size="md" portal>
      <ModalHeader title="Add to team" onClose={onClose} />
      <ModalBody className="space-y-4">
        {ledTeams.length > 1 && (
          <div>
            <label
              htmlFor="leader-add-team"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Team
            </label>
            <SelectMenu
              id="leader-add-team"
              options={teamOptions}
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                setUid("");
              }}
            />
          </div>
        )}
        <div>
          <label
            htmlFor="leader-add-person"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Person in the directory
          </label>
          <SelectMenu
            id="leader-add-person"
            options={personOptions}
            value={uid}
            onChange={setUid}
            placeholder="Choose a person"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Only people already in the directory can be added. An admin
            creates new accounts and changes leaders.
          </p>
        </div>
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter className="px-4 pb-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

/** Rename a team the viewer leads (every team, for an admin). */
export function RenameTeamButton({
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" />
        Rename team
      </Button>
      {open && (
        <RenameTeamModal
          teams={teams}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function RenameTeamModal({
  teams,
  onClose,
  onDone,
}: {
  teams: Team[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sorted = [...teams].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const [teamId, setTeamId] = useState(sorted[0].id);
  const [name, setName] = useState(sorted[0].name);

  const teamOptions: SelectOption[] = sorted.map((t) => ({ value: t.id, label: t.name }));

  function submit() {
    if (!name.trim()) {
      setError("Team name is required");
      return;
    }
    setError(null);
    start(async () => {
      const result = await renameTeam(teamId, name);
      if (result.ok) {
        onDone(result.message);
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <ModalShell open onClose={onClose} ariaLabel="Rename team" size="md" portal>
      <ModalHeader title="Rename team" onClose={onClose} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ModalBody className="space-y-4">
          {sorted.length > 1 && (
            <div>
              <label
                htmlFor="rename-team-which"
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Team
              </label>
              <SelectMenu
                id="rename-team-which"
                options={teamOptions}
                value={teamId}
                onChange={(v) => {
                  setTeamId(v);
                  setName(sorted.find((t) => t.id === v)?.name ?? "");
                  setError(null);
                }}
              />
            </div>
          )}
          <div>
            <label
              htmlFor="rename-team-name"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              New name
            </label>
            <Input
              id="rename-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
            <p className="mt-1 text-xs text-zinc-500">
              The team keeps its people, rocks, to-dos and meetings — only the
              name changes.
            </p>
          </div>
          {error && (
            <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </ModalBody>
        <ModalFooter className="px-4 pb-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Rename
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

/** Small x on a team chip the viewer leads; confirms, then removes. */
export function RemoveFromTeamButton({
  teamId,
  teamName,
  userId,
  personName,
  onDone,
}: {
  teamId: string;
  teamName: string;
  userId: string;
  personName: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Remove ${personName} from ${teamName}?`)) return;
    setError(null);
    start(async () => {
      const result = await removeTeamMember(teamId, userId);
      if (result.ok) {
        onDone(`${personName}: ${result.message}`);
        router.refresh();
      } else {
        setError(result.error);
        window.alert(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      title={error ?? `Remove from ${teamName}`}
      aria-label={`Remove ${personName} from ${teamName}`}
      className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-300 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
    </button>
  );
}
