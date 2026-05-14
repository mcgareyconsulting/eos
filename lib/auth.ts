import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { user, supabase };
}

export async function getUserTeams() {
  const { user, supabase } = await requireUser();
  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id, role, teams(id, name)")
    .eq("user_id", user.id);

  type Row = {
    team_id: string;
    role: string;
    teams: { id: string; name: string } | null;
  };

  const teams = ((memberships ?? []) as unknown as Row[])
    .filter((m) => m.teams)
    .map((m) => ({ id: m.teams!.id, name: m.teams!.name, role: m.role }));

  return { user, supabase, teams };
}
