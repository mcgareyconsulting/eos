import { redirect } from "next/navigation";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import { requireAdmin } from "@/lib/firebase/teams";
import { CreateTeamWizard } from "@/app/(app)/teams/[teamId]/members/create-team-wizard";

/**
 * Create team without a Members team context (first team / teamless admin).
 * When the user already has team access, send them through Members → New team.
 */
export default async function DirectoryNewTeamPage() {
  await requireAdmin();
  const { teams } = await getUserTeamsFirebase();

  if (teams.length > 0) {
    redirect(`/teams/${teams[0].id}/members/new-team`);
  }

  return (
    <CreateTeamWizard backHref="/directory" backLabel="Directory" />
  );
}
