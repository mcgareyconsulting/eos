import { requireAdmin, requireTeamAccess } from "@/lib/firebase/teams";
import { CreateTeamWizard } from "./create-team-wizard";

/**
 * Admin create-team flow, reached from the Directory with a team context.
 */
export default async function NewTeamUnderMembersPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  // Must be able to open this team context (member or admin) and be org admin.
  await requireTeamAccess(teamId);
  await requireAdmin();

  return (
    <CreateTeamWizard
      backHref="/directory"
      backLabel="Directory"
    />
  );
}
