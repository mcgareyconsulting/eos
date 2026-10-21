"use client";

import { useEffect, useMemo, useState } from "react";
import { OwnerPicker, type OrgPerson } from "@/components/ui/owner-picker";
import { loadTodoDirectory } from "./actions";

type Member = { user_id: string; full_name: string };
type Directory = { people: OrgPerson[]; teams: { id: string; name: string }[] };

/**
 * The org directory, shared by every to-do form on the page. Fetched when a
 * form mounts (the modal opens), kept for the page's life; a failed fetch
 * clears itself so the next form retries. Same idea as the rock modal's
 * `orgPeopleCache`.
 */
let directoryCache: Promise<Directory> | null = null;
function fetchDirectory(): Promise<Directory> {
  directoryCache ??= loadTodoDirectory().catch((err) => {
    directoryCache = null;
    throw err;
  });
  return directoryCache;
}

/**
 * The to-do Owner field: a directory search (spec §2.3, §3.1 — a member
 * may assign a to-do to a person on any team). Reuses the milestone owner
 * picker (P6a): the first tab is this team, "Whole org" searches everyone
 * by name or team and shows each person's teams. An owner off this team
 * gets a note under the field saying what they will be able to do.
 */
export function TodoOwnerField({
  teamId,
  members,
  value,
  onChange,
}: {
  teamId: string;
  members: Member[];
  value: string;
  /** `name` is the picked person's name when known — the L10 capture uses it
   *  to say whose ownership it cleared on a switch to Issue. */
  onChange: (userId: string, name?: string) => void;
}) {
  const [directory, setDirectory] = useState<Directory | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDirectory()
      .then((d) => {
        if (!cancelled) setDirectory(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const teamNameById = useMemo(
    () => new Map((directory?.teams ?? []).map((t) => [t.id, t.name])),
    [directory],
  );
  const onTeam = !value || members.some((m) => m.user_id === value);
  const nameOf = (id: string) =>
    members.find((m) => m.user_id === id)?.full_name ??
    directory?.people.find((p) => p.user_id === id)?.full_name;
  const valueName = nameOf(value) ?? (value ? "…" : "Choose owner");
  const ownerTeams = (directory?.people.find((p) => p.user_id === value)?.team_ids ?? [])
    .map((id) => teamNameById.get(id) ?? "Team")
    .join(", ");

  return (
    <div>
      <OwnerPicker
        value={value}
        valueName={valueName}
        onChange={(id) => onChange(id, nameOf(id))}
        team={{
          id: teamId,
          name: teamNameById.get(teamId) ?? "This team",
          people: members,
        }}
        orgPeople={directory?.people ?? null}
        onNeedOrg={() => {
          fetchDirectory()
            .then(setDirectory)
            .catch(() => {});
        }}
        teamNameById={teamNameById}
        variant="field"
        label="Owner"
      />
      {!onTeam && (
        <p className="mt-1 text-[11px] leading-snug text-zinc-500">
          Not on this team{ownerTeams ? ` (${ownerTeams})` : ""}. They will see
          this to-do on their Home and To-Dos page, and can complete it and
          comment.
        </p>
      )}
    </div>
  );
}
