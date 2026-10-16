"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Search, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { DirectoryPerson } from "@/lib/firebase/directory";
import { isLeaderOf, type Viewer } from "@/lib/access/types";
import { ExportControl } from "@/components/export/export-control";
import { NO_TEAM, filterDirectory } from "@/lib/directory-filter";
import { directoryExportParams } from "@/lib/export/urls";
import { AddPersonButton, NewTeamButton, PersonRowMenu } from "./directory-admin";
import { LeaderAddButton, RemoveFromTeamButton } from "./directory-leader";

const ACCESS_LABEL: Record<DirectoryPerson["access"], string> = {
  admin: "Admin",
  leader: "Leader",
  member: "Member",
};

const ACCESS_OPTIONS = (Object.keys(ACCESS_LABEL) as DirectoryPerson["access"][]).map(
  (value) => ({ value, label: ACCESS_LABEL[value] }),
);

/** The Team and Role access cells stack one line per team; both use these
 *  so each role pill sits level with its team. */
const ROWS_CLASS = "flex flex-col gap-1";
const ROW_CLASS = "flex h-5 min-w-0 items-center";

export function DirectoryTable({
  people,
  teams,
  openableTeamIds,
  currentUserId,
  leaderTeamIds,
  isAdmin,
}: {
  people: DirectoryPerson[];
  teams: { id: string; name: string }[];
  /** Teams the viewer can open for data — chips for these link to the team. */
  openableTeamIds: string[];
  currentUserId: string;
  /** Teams the viewer leads (admins manage rosters through the row menu). */
  leaderTeamIds: string[];
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  // Empty set = no filter. Both are OR within the filter, AND across them.
  const [access, setAccess] = useState<Set<string>>(() => new Set());
  const [team, setTeam] = useState<Set<string>>(() => new Set());
  // One banner for whatever admin action last succeeded; errors stay inside
  // the modal that produced them.
  const [notice, setNotice] = useState<string | null>(null);

  const openable = useMemo(() => new Set(openableTeamIds), [openableTeamIds]);
  const viewer: Viewer = useMemo(
    () => ({
      uid: currentUserId,
      isAdmin,
      teamIds: new Set(openableTeamIds),
      leaderOf: new Set(leaderTeamIds),
    }),
    [currentUserId, isAdmin, openableTeamIds, leaderTeamIds],
  );
  const ledTeams = useMemo(
    () => teams.filter((t) => isLeaderOf(viewer, t.id)),
    [teams, viewer],
  );
  // Admins use the row menu; the leader controls are for non-admin leaders.
  const showLeaderTools = !isAdmin && ledTeams.length > 0;

  // lib/directory-filter.ts, shared with the export.
  const filtered = useMemo(
    () => filterDirectory(people, { query, access, team }),
    [people, query, access, team],
  );

  const filtering = query.trim() !== "" || access.size > 0 || team.size > 0;

  const teamOptions = useMemo(
    () => [...teams.map((t) => ({ value: t.id, label: t.name })), { value: NO_TEAM, label: "No team" }],
    [teams],
  );

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href="/admin/import"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Upload className="h-4 w-4" />
            Import seed file
          </Link>
          <NewTeamButton people={people} onDone={setNotice} />
          <AddPersonButton teams={teams} onDone={setNotice} />
          <DirectoryExport query={query} access={access} team={team} />
        </div>
      )}

      {showLeaderTools && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <LeaderAddButton ledTeams={ledTeams} people={people} onDone={setNotice} />
          <DirectoryExport query={query} access={access} team={team} />
        </div>
      )}

      {!isAdmin && !showLeaderTools && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DirectoryExport query={query} access={access} team={team} />
        </div>
      )}

      {notice && (
        <p className="flex items-start gap-2 rounded-md bg-hpb-green/10 px-3 py-2 text-sm text-hpb-green ring-1 ring-inset ring-hpb-green/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or team"
            className="pl-8"
            aria-label="Search directory"
          />
        </div>
        <MultiSelect
          label="Role"
          options={ACCESS_OPTIONS}
          value={access}
          onChange={setAccess}
          className="w-36"
        />
        <MultiSelect
          label="Team"
          options={teamOptions}
          value={team}
          onChange={setTeam}
          searchable
          className="w-56"
        />
      </div>

      <p className="text-xs text-zinc-500">
        {filtering ? `${filtered.length} of ${people.length} people` : `${people.length} people`}
      </p>

      {/* No overflow clipping here: the row menus pop out below their cell,
          and a fixed-layout table never exceeds the card width anyway. */}
      <Card>
        {/* table-fixed + colgroup: widths come from here, not from whichever
            rows happen to be visible, so filtering doesn't reflow the header. */}
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[34%]" />
            <col className="w-[16%]" />
            <col className={isAdmin ? "w-[18%]" : "w-[22%]"} />
            {isAdmin && <col className="w-[4%]" />}
          </colgroup>
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2 font-medium">First Name</th>
              <th className="px-3 py-2 font-medium">Last Name</th>
              <th className="px-3 py-2 font-medium">Team</th>
              <th className="px-3 py-2 font-medium">Role access</th>
              <th className="px-3 py-2 font-medium">Email</th>
              {isAdmin && (
                <th className="px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-3 py-6 text-center text-zinc-500">
                  {people.length === 0
                    ? "Nobody here yet."
                    : "Nobody matches these filters."}
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.uid} className="align-top">
                <td className="break-words px-3 py-2 font-medium">
                  {p.firstName || <Blank />}
                  {p.uid === currentUserId && (
                    <span className="ml-1.5 text-xs font-normal text-zinc-500">(you)</span>
                  )}
                </td>
                <td className="break-words px-3 py-2 font-medium">
                  {p.lastName || <Blank />}
                </td>
                <td className="px-3 py-2">
                  {p.teams.length === 0 ? (
                    <span className="text-xs text-zinc-400">No team</span>
                  ) : (
                    // One team per line; the Role access cell lines up a
                    // pill beside each (same ROW_CLASS height and gap).
                    <div className={ROWS_CLASS}>
                      {p.teams.map((t) => (
                        <TeamRow
                          key={t.id}
                          name={t.name}
                          href={openable.has(t.id) ? `/teams/${t.id}/scorecard` : null}
                          remove={
                            showLeaderTools && isLeaderOf(viewer, t.id) && t.role !== "leader" ? (
                              <RemoveFromTeamButton
                                teamId={t.id}
                                teamName={t.name}
                                userId={p.uid}
                                personName={`${p.firstName} ${p.lastName}`.trim() || "Person"}
                                onDone={setNotice}
                              />
                            ) : null
                          }
                        />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {/* One pill per team line: Admin everywhere for an admin,
                      otherwise that team's role. No team (or deactivated)
                      → a single pill. Account state rides the first line. */}
                  <div className={ROWS_CLASS}>
                    {(p.deactivated || p.teams.length === 0
                      ? [null]
                      : p.teams
                    ).map((t, i) => (
                      <div key={t?.id ?? "none"} className={ROW_CLASS}>
                        {p.deactivated ? (
                          <Chip tone="amber">Deactivated</Chip>
                        ) : (
                          <AccessChip
                            access={
                              p.access === "admin" || !t
                                ? p.access
                                : t.role === "leader"
                                  ? "leader"
                                  : "member"
                            }
                          />
                        )}
                        {/* Account state is an admin concern — it's what the
                            old People tab existed to show, and means nothing
                            to anyone who can't fix it. */}
                        {i === 0 && isAdmin && p.hasAuth === false && (
                          <Chip tone="amber" title="No sign-in account — a placeholder left by a data import.">
                            No account
                          </Chip>
                        )}
                        {i === 0 && isAdmin && p.hasAuth && p.hasSignedIn === false && (
                          <Chip tone="zinc">Never signed in</Chip>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="break-all px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {p.email ?? <Blank />}
                </td>
                {isAdmin && (
                  <td className="px-2 py-1.5">
                    <PersonRowMenu
                      person={p}
                      teams={teams}
                      isSelf={p.uid === currentUserId}
                      onDone={setNotice}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/**
 * Export of exactly the filtered list, for everyone (docs/EXPORT.md). The
 * server builds the file as this viewer sees the page: account state and
 * deactivated people for admins only.
 */
function DirectoryExport({
  query,
  access,
  team,
}: {
  query: string;
  access: ReadonlySet<string>;
  team: ReadonlySet<string>;
}) {
  return (
    <ExportControl
      exportId="directory"
      params={directoryExportParams({ query, access, teams: team })}
    />
  );
}

function Blank() {
  return <span className="text-zinc-400">—</span>;
}

/** One line of the Team cell: the team chip, plus the leader's remove
 *  control. Its role shows on the same line of the Role access cell. */
function TeamRow({
  name,
  href,
  remove,
}: {
  name: string;
  href: string | null;
  remove: React.ReactNode;
}) {
  const cls =
    "block min-w-0 max-w-full truncate rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] leading-4 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700";
  return (
    <div className={ROW_CLASS}>
      {href ? (
        <Link
          href={href}
          title={name}
          className={`${cls} hover:bg-zinc-200 dark:hover:bg-zinc-700`}
        >
          {name}
        </Link>
      ) : (
        <span
          className={cls}
          title={`${name} — you can see who is on this team, but not its data, until a leader adds you.`}
        >
          {name}
        </span>
      )}
      {remove}
    </div>
  );
}

function AccessChip({ access }: { access: DirectoryPerson["access"] }) {
  return (
    <Chip tone={access === "member" ? "zinc" : "blue"}>{ACCESS_LABEL[access]}</Chip>
  );
}

const CHIP_TONE = {
  blue: "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20",
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
      className={`mr-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${CHIP_TONE[tone]}`}
    >
      {children}
    </span>
  );
}
