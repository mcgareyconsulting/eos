import { AppShell } from "@/components/app-shell";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import { isOrgReader } from "@/lib/firebase/teams";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, teams, isAdmin, membershipTeamIds, leaderTeamIds } =
    await getUserTeamsFirebase();

  // Teams whose Import page this user may open (leader-or-admin — mirrors
  // requireTeamLeader on the page/action). Admins get every sidebar team.
  const importTeamIds = isAdmin ? teams.map((t) => t.id) : leaderTeamIds;

  // Gates the org-wide Data link. Admins short-circuit inside isOrgReader, so
  // this only costs a read for the non-admins it has to check.
  const orgReader = await isOrgReader();

  // Teamless users stay in the shell so they can use Directory (org-wide
  // roster). Team *data* routes still 404 via requireTeamAccess until invited.
  return (
    <AppShell
      user={user}
      profile={profile}
      teams={teams}
      isAdmin={isAdmin}
      membershipCount={membershipTeamIds.length}
      importTeamIds={importTeamIds}
      isOrgReader={orgReader}
    >
      {children}
    </AppShell>
  );
}
