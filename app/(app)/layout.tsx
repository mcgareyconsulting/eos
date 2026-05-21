import { AppShell } from "@/components/app-shell";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, teams } = await getUserTeamsFirebase();
  const team = teams[0] ?? null;

  return (
    <AppShell user={user} profile={profile} team={team}>
      {children}
    </AppShell>
  );
}
