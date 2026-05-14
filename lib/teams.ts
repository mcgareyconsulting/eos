import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

export async function requireTeamAccess(teamId: string) {
  const { user, supabase } = await requireUser();

  const { data: team, error } = await supabase
    .from("teams")
    .select("id, name, org_id")
    .eq("id", teamId)
    .single();

  if (error || !team) notFound();
  return { user, supabase, team };
}

export type TeamMember = {
  user_id: string;
  full_name: string;
  email: string;
};

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("team_members")
    .select("user_id, profiles(full_name, email)")
    .eq("team_id", teamId);

  type Row = {
    user_id: string;
    profiles: { full_name: string; email: string } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.profiles)
    .map((r) => ({
      user_id: r.user_id,
      full_name: r.profiles!.full_name,
      email: r.profiles!.email,
    }));
}

export function onTrack(
  value: number | null,
  goal: number | null,
  direction: "gte" | "lte" | "eq",
): boolean | null {
  if (value == null || goal == null) return null;
  if (direction === "gte") return value >= goal;
  if (direction === "lte") return value <= goal;
  return value === goal;
}
