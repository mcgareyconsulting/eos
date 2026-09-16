import { requireAdmin } from "@/lib/firebase/teams";
import { getAdminTeams } from "@/lib/firebase/org-people";
import { AdminHeader, AdminTabs } from "../admin-tabs";
import { TeamsAdmin } from "./teams-admin";

export default async function AdminTeamsPage() {
  await requireAdmin();
  const teams = await getAdminTeams();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminHeader
        title="Teams"
        blurb="Create and rename teams. The seed file matches teams by name, so a team renamed here is created fresh by the next import unless that file uses the new name too."
      />
      <AdminTabs active="teams" />
      <TeamsAdmin teams={teams} />
    </div>
  );
}
