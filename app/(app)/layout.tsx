import { AppShell } from "@/components/app-shell";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";

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
    >
      {children}
    </AppShell>
  );
}
