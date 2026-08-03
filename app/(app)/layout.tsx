import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, teams } = await getUserTeamsFirebase();

  // Users not on any team can't use the app chrome (it's all team-scoped).
  // Send them to /join to request membership; a leader approves.
  if (teams.length === 0) redirect("/join");

  return (
    <AppShell user={user} profile={profile} teams={teams}>
      {children}
    </AppShell>
  );
}
