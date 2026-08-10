import Link from "next/link";
import { Building2, Plus, Shield } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { DirectoryTeam } from "@/lib/firebase/teams";

/**
 * Org-wide team directory (soft tenancy: names + roster only).
 * Used as the "All teams" tab on Members.
 */
export function OrgDirectoryPanel({
  directory,
  membershipTeamIds,
  currentUserId,
  isAdmin,
  /** Team context for "New team" deep link (admin). */
  contextTeamId,
}: {
  directory: DirectoryTeam[];
  membershipTeamIds: string[];
  currentUserId: string;
  isAdmin: boolean;
  contextTeamId?: string;
}) {
  const membershipSet = new Set(membershipTeamIds);
  const newTeamHref = contextTeamId
    ? `/teams/${contextTeamId}/members/new-team`
    : "/directory/new";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          All teams and members across the organization. Opening a team&rsquo;s
          scorecard, rocks, and other data requires membership
          {isAdmin ? " (you have admin access to every team)" : ""}.
        </p>
        {isAdmin && (
          <Link
            href={newTeamHref}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            New team
          </Link>
        )}
      </div>

      {directory.length === 0 ? (
        <div className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <EmptyState
            icon={Building2}
            title="No teams yet"
            hint={
              isAdmin
                ? "Create the first team and invite a leader."
                : "An administrator will create teams and invite leaders."
            }
          />
          {isAdmin && (
            <div className="pb-6 text-center">
              <Link
                href={newTeamHref}
                className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
              >
                <Plus className="h-4 w-4" />
                New team
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {directory.map((team) => {
            const onTeam = membershipSet.has(team.id);
            const canOpen = isAdmin || onTeam;
            return (
              <section
                key={team.id}
                className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">
                      {team.name}
                    </h2>
                    <p className="text-xs text-zinc-500">
                      {team.members.length}{" "}
                      {team.members.length === 1 ? "member" : "members"}
                      {onTeam && (
                        <span className="ml-2 text-hpb-blue dark:text-hpb-gold">
                          · Your team
                        </span>
                      )}
                      {isAdmin && !onTeam && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-zinc-500">
                          <Shield className="h-3 w-3" />
                          Admin access
                        </span>
                      )}
                    </p>
                  </div>
                  {canOpen ? (
                    <Link
                      href={`/teams/${team.id}/members`}
                      className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      Open team
                    </Link>
                  ) : (
                    <span
                      className="shrink-0 text-xs text-zinc-500"
                      title="You can see who is on this team, but not its data, until a leader adds you."
                    >
                      View only
                    </span>
                  )}
                </div>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {team.members.length === 0 ? (
                    <li className="px-4 py-4 text-sm text-zinc-500">
                      No members yet.
                    </li>
                  ) : (
                    team.members.map((m) => (
                      <li
                        key={m.user_id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">
                            {m.full_name}
                            {m.user_id === currentUserId && (
                              <span className="ml-1.5 text-xs font-normal text-zinc-500">
                                (you)
                              </span>
                            )}
                          </span>
                          {m.email && (
                            <div className="truncate text-xs text-zinc-500">
                              {m.email}
                            </div>
                          )}
                        </div>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            m.role === "leader"
                              ? "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20"
                              : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
                          }`}
                        >
                          {m.role === "leader" ? "Leader" : "Member"}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
