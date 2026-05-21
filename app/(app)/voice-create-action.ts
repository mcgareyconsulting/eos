"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import {
  parseVoiceAudio,
  type ActionItem,
  type VoiceAction,
} from "@/lib/voice/parse";
import { endOfQuarter, toDateString } from "@/lib/dates";
import { setRockStatus, addMilestone } from "./teams/[teamId]/rocks/actions";
import { toggleTodo } from "./teams/[teamId]/todos/actions";

// Resolved + validated single action ready to commit. One per item the
// speaker requested in their utterance.
export type ResolvedAction =
  | {
      action: "create_todo";
      title: string;
      description: string | null;
      due_date: string | null;
      owner_id: string;
      owner_name: string;
    }
  | {
      action: "create_issue";
      title: string;
      description: string | null;
      owner_id: string;
      owner_name: string;
    }
  | {
      action: "create_rock";
      title: string;
      description: string | null;
      due_date: string | null;
      quarter: string;
      owner_id: string;
      owner_name: string;
    }
  | {
      action: "update_rock_status";
      rock_id: string;
      rock_title: string;
      status: "on_track" | "off_track" | "done" | "cancelled";
      comment: string | null;
    }
  | {
      action: "add_milestone";
      rock_id: string;
      rock_title: string;
      title: string;
      owner_id: string;
      owner_name: string;
      due_date: string | null;
    }
  | {
      action: "complete_milestone";
      milestone_id: string;
      milestone_title: string;
      rock_title: string;
    };

export type ParsedVoice = {
  teamId: string;
  items: ResolvedAction[];
  transcript: string;
};

export type CommitResult = {
  ok: true;
  teamId: string;
  summaries: { action: VoiceAction; summary: string }[];
  transcript: string;
  path: string;
};

// Step 1: audio → Gemini → parsed preview. Resolves N actions against the
// team's current rocks/milestones. Does NOT mutate anything.
export async function voiceParse(formData: FormData): Promise<ParsedVoice> {
  const file = formData.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No audio recorded");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Recording too long (max ~15MB)");
  }

  const teamIdRaw = String(formData.get("team_id") ?? "").trim();
  const { uid, name, email } = await requireFirebaseUser();
  const teamId = teamIdRaw || (await firstTeamId(uid));
  if (!teamId) throw new Error("No team available");

  const { db } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const [rocksSnap, milestonesSnap] = await Promise.all([
    db.collection("rocks").where("team_id", "==", teamId).get(),
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("completed_at", "==", null)
      .get(),
  ]);

  const rocks = rocksSnap.docs.map((d) => {
    const data = d.data() as { title: string; status: string };
    return { id: d.id, title: data.title, status: data.status };
  });
  const rockTitleById = new Map(rocks.map((r) => [r.id, r.title]));

  const openMilestones = milestonesSnap.docs
    .map((d) => {
      const data = d.data() as { title: string; source_rock_id: string | null };
      return {
        id: d.id,
        title: data.title,
        source_rock_id: data.source_rock_id,
      };
    })
    .filter((t) => t.source_rock_id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      rock_title: rockTitleById.get(t.source_rock_id!) ?? "—",
    }));

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseVoiceAudio({
    audioBase64: buffer.toString("base64"),
    mimeType: file.type || "audio/webm",
    memberNames: members.map((m) => m.full_name).filter((n) => n && n !== "—"),
    currentUserName: name || email || "me",
    rocks,
    openMilestones,
  });

  const items: ResolvedAction[] = [];
  for (let i = 0; i < parsed.actions.length; i++) {
    const a = parsed.actions[i];
    const positional = parsed.actions.length > 1 ? ` (action ${i + 1})` : "";
    items.push(resolveAction(a, positional, rocks, openMilestones, members, uid, name, email));
  }

  return {
    teamId,
    items,
    transcript: parsed.transcript,
  };
}

function resolveAction(
  a: ActionItem,
  positional: string,
  rocks: { id: string; title: string; status: string }[],
  openMilestones: { id: string; title: string; rock_title: string }[],
  members: { user_id: string; full_name: string }[],
  uid: string,
  name: string | null,
  email: string | null,
): ResolvedAction {
  const owner = resolveOwner(a.owner_name, members, uid, name, email);
  switch (a.action) {
    case "create_todo":
      requireField(a.title, `to-do title${positional}`);
      return {
        action: "create_todo",
        title: a.title!,
        description: a.description,
        due_date: a.due_date,
        owner_id: owner.user_id,
        owner_name: owner.full_name,
      };
    case "create_issue":
      requireField(a.title, `issue title${positional}`);
      return {
        action: "create_issue",
        title: a.title!,
        description: a.description,
        owner_id: owner.user_id,
        owner_name: owner.full_name,
      };
    case "create_rock":
      requireField(a.title, `rock title${positional}`);
      return {
        action: "create_rock",
        title: a.title!,
        description: a.description,
        due_date: a.due_date ?? toDateString(endOfQuarter()),
        quarter: a.quarter ?? quarterOfNow(),
        owner_id: owner.user_id,
        owner_name: owner.full_name,
      };
    case "update_rock_status": {
      requireField(a.rock_id, `rock${positional}`);
      requireField(a.status, `status${positional}`);
      const rock = rocks.find((r) => r.id === a.rock_id);
      if (!rock) {
        throw new Error(
          `Couldn't match a rock${positional}. Re-record and use the rock's name more clearly.`,
        );
      }
      if (a.status === "off_track" && !a.comment?.trim()) {
        throw new Error(
          `Going "${rock.title}" off-track needs a reason${positional}. Say why and re-record.`,
        );
      }
      return {
        action: "update_rock_status",
        rock_id: rock.id,
        rock_title: rock.title,
        status: a.status!,
        comment: a.comment?.trim() || null,
      };
    }
    case "add_milestone": {
      requireField(a.rock_id, `rock${positional}`);
      requireField(a.title, `milestone title${positional}`);
      const rock = rocks.find((r) => r.id === a.rock_id);
      if (!rock) {
        throw new Error(
          `Couldn't match a rock${positional}. Re-record and name the rock more clearly.`,
        );
      }
      return {
        action: "add_milestone",
        rock_id: rock.id,
        rock_title: rock.title,
        title: a.title!,
        owner_id: owner.user_id,
        owner_name: owner.full_name,
        due_date: a.due_date ?? toDateString(endOfQuarter()),
      };
    }
    case "complete_milestone": {
      requireField(a.milestone_id, `milestone${positional}`);
      const ms = openMilestones.find((m) => m.id === a.milestone_id);
      if (!ms) {
        throw new Error(
          `Couldn't match an open milestone${positional}. Re-record and name it more clearly.`,
        );
      }
      return {
        action: "complete_milestone",
        milestone_id: ms.id,
        milestone_title: ms.title,
        rock_title: ms.rock_title,
      };
    }
  }
}

// Step 2: user confirmed → apply each item in order. Stops on first failure
// and reports which actions ran. Errors before any commit do nothing.
export async function voiceCommit(parsed: ParsedVoice): Promise<CommitResult> {
  const { db } = await requireTeamAccess(parsed.teamId);
  const summaries: CommitResult["summaries"] = [];
  const pathsToRevalidate = new Set<string>();

  for (const item of parsed.items) {
    const summary = await applyItem(db, parsed.teamId, item, pathsToRevalidate);
    summaries.push({ action: item.action, summary });
  }

  for (const p of pathsToRevalidate) revalidatePath(p);

  // Path the "View" link points to — the action most likely to be inspected.
  // Priority: rocks-modifying > rocks-creating > issues > todos.
  const primary = pickPrimaryPath(parsed.teamId, parsed.items);
  return {
    ok: true,
    teamId: parsed.teamId,
    summaries,
    transcript: parsed.transcript,
    path: primary,
  };
}

async function applyItem(
  db: FirebaseFirestore.Firestore,
  teamId: string,
  item: ResolvedAction,
  paths: Set<string>,
): Promise<string> {
  switch (item.action) {
    case "create_todo": {
      const ownerId = await safeOwnerId(teamId, item.owner_id);
      await db.collection("todos").add({
        team_id: teamId,
        title: item.title,
        owner_id: ownerId,
        due_date: item.due_date,
        completed_at: null,
        visibility: "team",
        source_issue_id: null,
        source_meeting_id: null,
        source_rock_id: null,
        created_at: FieldValue.serverTimestamp(),
      });
      paths.add(`/teams/${teamId}/todos`);
      return `Added to-do: ${item.title}`;
    }
    case "create_issue": {
      const ownerId = await safeOwnerId(teamId, item.owner_id);
      await db.collection("issues").add({
        team_id: teamId,
        title: item.title,
        description: item.description,
        owner_id: ownerId,
        priority: 3,
        votes: 0,
        type: "short",
        status: "open",
        resolved_at: null,
        resolution_todo_id: null,
        created_at: FieldValue.serverTimestamp(),
      });
      paths.add(`/teams/${teamId}/issues`);
      return `Added issue: ${item.title}`;
    }
    case "create_rock": {
      const ownerId = await safeOwnerId(teamId, item.owner_id);
      await db.collection("rocks").add({
        team_id: teamId,
        title: item.title,
        quarter: item.quarter,
        due_date: item.due_date,
        owner_id: ownerId,
        description: item.description,
        status: "on_track",
        created_at: FieldValue.serverTimestamp(),
      });
      paths.add(`/teams/${teamId}/rocks`);
      return `Added rock: ${item.title}`;
    }
    case "update_rock_status": {
      await setRockStatus(
        teamId,
        item.rock_id,
        item.status,
        item.comment,
      );
      paths.add(`/teams/${teamId}/rocks`);
      return `Status → ${labelFor(item.status)} on "${item.rock_title}"`;
    }
    case "add_milestone": {
      const fd = new FormData();
      fd.set("title", item.title);
      fd.set("owner_id", item.owner_id);
      if (item.due_date) fd.set("due_date", item.due_date);
      await addMilestone(teamId, item.rock_id, fd);
      paths.add(`/teams/${teamId}/rocks`);
      return `Milestone "${item.title}" added to "${item.rock_title}"`;
    }
    case "complete_milestone": {
      // toggleTodo flips state; pass currentlyComplete=false to mark it done.
      await toggleTodo(teamId, item.milestone_id, false);
      paths.add(`/teams/${teamId}/rocks`);
      return `Completed milestone: "${item.milestone_title}"`;
    }
  }
}

function pickPrimaryPath(teamId: string, items: ResolvedAction[]): string {
  const priority: VoiceAction[] = [
    "update_rock_status",
    "add_milestone",
    "complete_milestone",
    "create_rock",
    "create_issue",
    "create_todo",
  ];
  for (const a of priority) {
    const hit = items.find((i) => i.action === a);
    if (hit) {
      if (a === "create_issue") return `/teams/${teamId}/issues`;
      if (a === "create_todo") return `/teams/${teamId}/todos`;
      return `/teams/${teamId}/rocks`;
    }
  }
  return `/teams/${teamId}/rocks`;
}

function labelFor(status: string): string {
  return (
    {
      on_track: "On Track",
      off_track: "Off Track",
      done: "Done",
      cancelled: "Cancelled",
    }[status] ?? status
  );
}

function requireField<T>(v: T, name: string): asserts v is NonNullable<T> {
  if (v == null || v === "") {
    throw new Error(`Couldn't extract ${name} from the audio. Try again with more detail.`);
  }
}

function quarterOfNow(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

async function safeOwnerId(teamId: string, ownerId: string): Promise<string> {
  const members = await getTeamMembers(teamId);
  const { uid } = await requireFirebaseUser();
  return members.some((m) => m.user_id === ownerId) ? ownerId : uid;
}

function resolveOwner(
  ownerName: string | null,
  members: { user_id: string; full_name: string }[],
  uid: string,
  name: string | null,
  email: string | null,
): { user_id: string; full_name: string } {
  const selfName = (name || email || "me").trim();
  if (!ownerName) return { user_id: uid, full_name: selfName };
  const target = ownerName.trim().toLowerCase();
  if (["me", "myself", "i"].includes(target)) {
    return { user_id: uid, full_name: selfName };
  }
  if (selfName && target === selfName.toLowerCase()) {
    return { user_id: uid, full_name: selfName };
  }
  const match = members.find((m) => m.full_name.toLowerCase() === target);
  if (match) return match;
  return { user_id: uid, full_name: selfName };
}

async function firstTeamId(uid: string): Promise<string | null> {
  const { db } = await requireFirebaseUser();
  const snap = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .limit(1)
    .get();
  const first = snap.docs[0];
  return first ? (first.data().team_id as string) : null;
}
