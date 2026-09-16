import { requireAdmin } from "@/lib/firebase/teams";
import { getAdminTeams, getOrgPeople } from "@/lib/firebase/org-people";
import { AdminHeader, AdminTabs } from "../admin-tabs";
import { PeopleAdmin } from "./people-admin";

export default async function AdminPeoplePage() {
  const { uid } = await requireAdmin();
  const [people, teams] = await Promise.all([getOrgPeople(), getAdminTeams()]);

  return (
    // Wide: the roster table carries name, email, title, teams and status,
    // and narrower than this the team chips wrap onto three lines.
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminHeader
        title="People"
        blurb="Everyone the app knows about — from the seed file, from a team leader's invite, or from signing in. Adding someone here creates their account without emailing them; it activates on their first Google sign-in."
      />
      <AdminTabs active="people" />
      <PeopleAdmin
        people={people}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        currentUserId={uid}
      />
    </div>
  );
}
