"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AdminTeam } from "@/lib/firebase/org-people";
import { createOrgTeam, renameOrgTeam } from "../actions";

export function TeamsAdmin({ teams }: { teams: AdminTeam[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(
    action: (formData: FormData) => Promise<{ ok: boolean; message?: string; error?: string }>,
    formData: FormData,
    onDone: () => void,
  ) {
    setNotice(null);
    setError(null);
    start(async () => {
      const result = await action(formData);
      if (result.ok) {
        setNotice(result.message ?? "Saved.");
        onDone();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating((v) => !v)}>
          {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {creating ? "Cancel" : "New team"}
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

      {creating && (
        <Card className="p-4">
          <form
            action={(fd) => run(createOrgTeam, fd, () => setCreating(false))}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="min-w-[14rem] flex-1">
              <label
                htmlFor="new-team-name"
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Team name
              </label>
              <Input id="new-team-name" name="name" required autoFocus />
            </div>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create team
            </Button>
          </form>
          <p className="mt-2 text-xs text-zinc-500">
            The team starts empty and with no leader. Add members and promote
            one on its Members tab.
          </p>
        </Card>
      )}

      <Card divided>
        {teams.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No teams yet. Create one, or import a seed file.
          </p>
        )}
        {teams.map((team) => (
          <div key={team.id} className="px-4 py-3 text-sm">
            {editingId === team.id ? (
              <form
                action={(fd) => run(renameOrgTeam, fd, () => setEditingId(null))}
                className="flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="team_id" value={team.id} />
                <Input
                  name="name"
                  defaultValue={team.name}
                  required
                  autoFocus
                  className="min-w-[12rem] flex-1"
                  aria-label={`Rename ${team.name}`}
                />
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium">{team.name}</span>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {team.memberCount} member
                    {team.memberCount === 1 ? "" : "s"}
                    {team.leaderCount === 0 ? (
                      <span className="ml-1 text-amber-700 dark:text-amber-400">
                        · no leader yet
                      </span>
                    ) : (
                      ` · ${team.leaderCount} leader${team.leaderCount === 1 ? "" : "s"}`
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/teams/${team.id}/members`}
                    className="text-xs font-medium text-hpb-blue hover:underline dark:text-hpb-gold"
                  >
                    Members
                  </Link>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setNotice(null);
                      setError(null);
                      setEditingId(team.id);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
