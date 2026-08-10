import { AppShell } from "@/components/app-shell";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, teams, isAdmin, membershipTeamIds } =
    await getUserTeamsFirebase();

  // Teamless users stay in the shell so they can use Directory (org-wide
  // roster). Team *data* routes still 404 via requireTeamAccess until invited.
  return (
    <AppShell
      user={user}
      profile={profile}
      teams={teams}
      isAdmin={isAdmin}
      membershipCount={membershipTeamIds.length}
    >
      {children}
    </AppShell>
  );
}
