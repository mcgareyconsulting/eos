import { AppShell } from "@/components/app-shell";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    user,
    profile,
    teams,
    isAdmin,
    membershipTeamIds,
    leaderTeamIds,
    db,
  } = await getUserTeamsFirebase();

  // Unread badge for first paint; the sidebar's listener takes over after
  // client auth. One aggregation read per page render — cheap, and it means
  // the count never flashes from 0 to N on load.
  let unreadNotifications = 0;
  try {
    // Not `.count()`: archived rows are excluded, and `archived_at` is
    // absent on rows older than the Archived tab, which an `== null` filter
    // would miss. Unread rows are few, so reading them is as cheap.
    const snap = await db
      .collection("notifications")
      .where("user_id", "==", user.id)
      .where("read_at", "==", null)
      .get();
    unreadNotifications = snap.docs.filter(
      (d) => d.data().archived_at == null,
    ).length;
  } catch (e) {
    console.error("[layout] unread notifications count failed:", e);
  }

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
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
