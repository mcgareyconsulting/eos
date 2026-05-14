"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mondayOf, toDateString } from "@/lib/dates";

export async function setScorecardValue(
  teamId: string,
  metricId: string,
  weekStart: string, // YYYY-MM-DD
  rawValue: string,
) {
  const supabase = await createClient();
  const trimmed = rawValue.trim();

  if (trimmed === "") {
    await supabase
      .from("scorecard_entries")
      .delete()
      .eq("metric_id", metricId)
      .eq("week_start_date", weekStart);
  } else {
    const value = Number(trimmed);
    if (Number.isNaN(value)) {
      throw new Error("Value must be a number");
    }
    await supabase
      .from("scorecard_entries")
      .upsert(
        { metric_id: metricId, week_start_date: weekStart, value },
        { onConflict: "metric_id,week_start_date" },
      );
  }
  revalidatePath(`/teams/${teamId}/scorecard`);
}

export async function addMetric(teamId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "number");
  const goalStr = String(formData.get("goal") ?? "").trim();
  const direction = String(formData.get("direction") ?? "gte");
  const ownerId = String(formData.get("owner_id") ?? "") || null;

  if (!name) throw new Error("Name required");
  const goal = goalStr === "" ? null : Number(goalStr);

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("scorecard_metrics")
    .select("sort_order")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("scorecard_metrics").insert({
    team_id: teamId,
    name,
    unit,
    goal,
    direction,
    owner_id: ownerId,
    sort_order: (existing?.sort_order ?? 0) + 1,
  });

  revalidatePath(`/teams/${teamId}/scorecard`);
}

export async function deleteMetric(teamId: string, metricId: string) {
  const supabase = await createClient();
  await supabase.from("scorecard_metrics").delete().eq("id", metricId);
  revalidatePath(`/teams/${teamId}/scorecard`);
}

// Convenience: returns this week's Monday so the UI doesn't have to compute it.
export async function thisWeekStart() {
  return toDateString(mondayOf());
}
