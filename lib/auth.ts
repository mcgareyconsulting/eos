import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Self-heal: if the auth trigger missed (which has happened on hosted),
  // make sure this user has a profile + team membership. Idempotent.
  await supabase.rpc("ensure_user_provisioned");

  return { user, supabase };
}

export type Profile = {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
};

export async function getUserTeams() {
  const { user, supabase } = await requireUser();

  const [profileRes, membershipsRes] = await Promise.all([
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
}
