import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
};

// Lightweight: just resolve auth.uid(). De-duped per request via React cache so
// repeated calls within the same render (layout + page) share one round-trip.
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { user, supabase };
});

// Single profile + memberships fetch per request. Self-heals if the profile
// row is missing — but only then, so the common case is just one query pair.
export const getUserTeams = cache(async () => {
  const { user, supabase } = await requireUser();

  const fetchProfileAndTeams = () =>
    Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name, email")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("team_members")
        .select("team_id, role, teams(id, name)")
        .eq("user_id", user.id),
    ]);

  let [profileRes, membershipsRes] = await fetchProfileAndTeams();

  if (!profileRes.data) {
    // First visit / trigger missed — provision and retry once.
    await supabase.rpc("ensure_user_provisioned");
    [profileRes, membershipsRes] = await fetchProfileAndTeams();
  }

  type Row = {
    team_id: string;
    role: string;
    teams: { id: string; name: string } | null;
  };

  const teams = ((membershipsRes.data ?? []) as unknown as Row[])
    .filter((m) => m.teams)
    .map((m) => ({ id: m.teams!.id, name: m.teams!.name, role: m.role }));

  const profile: Profile | null = profileRes.data ?? null;

  return { user, supabase, profile, teams };
});
