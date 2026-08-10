import { redirect } from "next/navigation";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import { getOrgDirectory } from "@/lib/firebase/teams";
import { OrgDirectoryPanel } from "@/app/(app)/teams/[teamId]/members/org-directory-panel";

/**
 * Legacy /directory route. Prefer Members → All teams when the user has a
 * team context. Teamless users still land here (no teamId for Members).
 */
export default async function DirectoryPage() {
  const { teams, isAdmin, membershipTeamIds, user } =
    await getUserTeamsFirebase();

  if (teams.length > 0) {
    redirect(`/teams/${teams[0].id}/members?tab=directory`);
  }

  // No team yet (common for brand-new admins before first create).
  const directory = await getOrgDirectory();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Org directory — you are not on a team yet.
        </p>
      </header>
      <OrgDirectoryPanel
        directory={directory}
        membershipTeamIds={membershipTeamIds}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  );
}
