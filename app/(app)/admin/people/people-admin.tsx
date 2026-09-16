"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
} from "@/components/ui/modal";
import type { OrgPerson } from "@/lib/firebase/org-people";
import { addOrgPerson, deleteOrgPerson } from "../actions";

type TeamOption = { id: string; name: string };

export function PeopleAdmin({
  people,
  teams,
  currentUserId,
}: {
  people: OrgPerson[];
  teams: TeamOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<OrgPerson | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.name, p.email ?? "", p.title ?? "", ...p.teams.map((t) => t.name)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [people, query]);

  function submitAdd(formData: FormData) {
    setNotice(null);
    setError(null);
    start(async () => {
      const result = await addOrgPerson(formData);
      if (result.ok) {
        setNotice(result.message);
        setAdding(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function confirmDelete(person: OrgPerson) {
    setNotice(null);
    setError(null);
    start(async () => {
      const result = await deleteOrgPerson(person.uid);
      setConfirming(null);
      if (result.ok) {
        setNotice(`${person.name}: ${result.message}`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, title or team"
            className="pl-8"
            aria-label="Search people"
          />
        </div>
        <Button onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Cancel" : "Add person"}
        </Button>
      </div>

      {notice && (
        <p className="flex items-start gap-2 rounded-md bg-hpb-green/10 px-3 py-2 text-sm text-hpb-green ring-1 ring-inset ring-hpb-green/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {adding && (
        <Card className="p-4">
          <form action={submitAdd} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name" htmlFor="first_name">
                <Input id="first_name" name="first_name" required />
              </Field>
              <Field label="Last name" htmlFor="last_name">
                <Input id="last_name" name="last_name" required />
              </Field>
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" required />
              </Field>
              <Field label="Job title (optional)" htmlFor="title">
                <Input id="title" name="title" placeholder="Branch Manager" />
              </Field>
              <Field label="Team (optional)" htmlFor="team_id">
                <Select id="team_id" name="team_id" defaultValue="">
                  <option value="">No team yet</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Team role" htmlFor="role">
                <Select id="role" name="role" defaultValue="member">
                  <option value="member">Member</option>
                  <option value="leader">Leader</option>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              No email is sent. This creates an empty account that activates
              when they first sign in with Google.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Add person
              </Button>
            </div>
          </form>
        </Card>
      )}

      <p className="text-xs text-zinc-500">
        {filtered.length} of {people.length} people
      </p>

      <Card divided>
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            Nobody matches “{query}”.
          </p>
        )}
        {filtered.map((person) => (
          <div
            key={person.uid}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{person.name}</span>
                {person.uid === currentUserId && (
                  <span className="text-xs text-zinc-500">(you)</span>
                )}
                {person.isOrgAdmin && (
                  <Chip tone="blue">Org admin</Chip>
                )}
                {person.deactivated && <Chip tone="red">Deactivated</Chip>}
                {!person.hasAuth && !person.deactivated && (
                  <Chip tone="amber" title="No sign-in account — a placeholder left by a data import.">
                    No account
                  </Chip>
                )}
                {person.hasAuth && !person.hasSignedIn && (
                  <Chip tone="zinc">Never signed in</Chip>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {person.email ?? "no email"}
                {person.title ? ` · ${person.title}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {person.teams.length === 0 ? (
                  <span className="text-xs text-zinc-400">No team</span>
                ) : (
                  person.teams.map((t) => (
                    <Link
                      key={t.id}
                      href={`/teams/${t.id}/members`}
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
                    >
                      {t.name}
                      {t.role === "leader" && " · leader"}
                    </Link>
                  ))
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={pending || person.uid === currentUserId}
              title={
                person.uid === currentUserId
                  ? "You can't delete your own account"
                  : `Remove ${person.name}'s access`
              }
              onClick={() => setConfirming(person)}
              className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        ))}
      </Card>

      <ModalShell
        open={!!confirming}
        onClose={() => setConfirming(null)}
        ariaLabel="Delete person"
        size="md"
        portal
      >
        <ModalHeader
          title={`Delete ${confirming?.name ?? ""}?`}
          onClose={() => setConfirming(null)}
        />
        <ModalBody>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            They are removed from{" "}
            <strong>
              {confirming?.teams.length ?? 0} team
              {(confirming?.teams.length ?? 0) === 1 ? "" : "s"}
            </strong>{" "}
            and can no longer sign in.
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            Their <strong>rocks, to-dos, issues and headlines stay where they
            are</strong>, still showing their name — nothing they owned is
            deleted or unassigned. Reassign that work first if someone needs to
            pick it up.
          </p>
          {confirming?.isOrgAdmin && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
              This person is an org admin. Deleting them removes that access
              too.
            </p>
          )}
        </ModalBody>
        <ModalFooter className="px-4 pb-4">
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            autoFocus
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
            onClick={() => confirming && confirmDelete(confirming)}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete person
          </Button>
        </ModalFooter>
      </ModalShell>
    </div>
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

const CHIP_TONE = {
  blue: "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  amber:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
} as const;

function Chip({
  tone,
  title,
  children,
}: {
  tone: keyof typeof CHIP_TONE;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${CHIP_TONE[tone]}`}
    >
      {children}
    </span>
  );
}
