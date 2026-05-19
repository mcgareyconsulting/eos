"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  SEGMENTS,
  type Segment,
  nextSegment,
} from "@/lib/l10/segments";

export async function startMeeting(teamId: string) {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("meetings")
    .insert({
      team_id: teamId,
      started_at: now,
      current_segment: "segue",
      segment_started_at: now,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath(`/teams/${teamId}/meetings`);
  redirect(`/teams/${teamId}/meetings/${data!.id}`);
}

export async function setSegment(
  teamId: string,
  meetingId: string,
  segment: Segment,
) {
  if (!SEGMENTS.includes(segment)) throw new Error("Invalid segment");
  const supabase = await createClient();
  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    current_segment: segment,
    segment_started_at: now,
  };
  if (segment === "done") {
    update.ended_at = now;
  }

  const { error } = await supabase
    .from("meetings")
    .update(update)
    .eq("id", meetingId);
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/meetings/${meetingId}`);
}

export async function advanceSegment(
  teamId: string,
  meetingId: string,
  fromSegment: Segment,
) {
  await setSegment(teamId, meetingId, nextSegment(fromSegment));
}

export async function endMeeting(teamId: string, meetingId: string) {
  await setSegment(teamId, meetingId, "done");
  redirect(`/teams/${teamId}/meetings`);
}

export async function submitRating(
  teamId: string,
  meetingId: string,
  score: number,
) {
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error("Score must be 1-10");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("meeting_ratings")
    .upsert(
      { meeting_id: meetingId, user_id: user.id, score: Math.round(score) },
      { onConflict: "meeting_id,user_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/meetings/${meetingId}`);
}

// Drop an off-track scorecard metric / off-track rock / overdue todo into the
// Issues list as a P5 short-term issue, tagged with the meeting id so it can be
// IDS'd in this same meeting.
export async function dropToIssues(
  teamId: string,
  meetingId: string,
  title: string,
  description?: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("issues").insert({
    team_id: teamId,
    title,
    description: description ?? null,
    priority: 5,
    type: "short",
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/meetings/${meetingId}`);
  revalidatePath(`/teams/${teamId}/issues`);
}
