import { AppShell } from "@/components/app-shell";
import { getUserTeams } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, teams } = await getUserTeams();
  const team = teams[0] ?? null;

  return (
    <AppShell user={user} team={team}>
      {children}
    </AppShell>
  );
}
