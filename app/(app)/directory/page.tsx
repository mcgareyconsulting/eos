import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import { getDirectoryPeople } from "@/lib/firebase/directory";
import { getOrgTeams } from "@/lib/firebase/teams";
import { DirectoryTable } from "./directory-table";

/**
 * The org Directory: everyone, one row each, in the seed file's own columns.
 * Replaces the admin People and Teams tabs and the Members → All teams tab,
 * which were three views of the same roster.
 */
export default async function DirectoryPage() {
  const [{ teams: openableTeams, isAdmin, user }, people, teams] =
    await Promise.all([getUserTeamsFirebase(), getDirectoryPeople(), getOrgTeams()]);

  return (
    // Wide: five columns, and the Team cell wraps chips for people on several
    // teams.
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Everyone in the organization and the teams they are on. Opening a
          team&rsquo;s data requires membership
          {isAdmin ? " (you have admin access to every team)" : ""}.
        </p>
      </header>
      <DirectoryTable
        people={people}
        teams={teams}
        openableTeamIds={openableTeams.map((t) => t.id)}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  );
}
