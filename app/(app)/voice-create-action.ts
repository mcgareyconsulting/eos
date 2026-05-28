"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import {
  chatRespond,
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
    }
  | {
      action: "complete_todo";
      todo_id: string;
      todo_title: string;
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

// One assistant turn returned to the chat UI. `items` are resolved, ready
// to confirm; `rawActions` is the model's own form, replayed next turn so a
// pending proposal can be refined. Nothing is committed here.
export type ChatReply = {
  reply: string;
  transcript: string;
  items: ResolvedAction[];
  rawActions: ActionItem[];
};

type TeamContext = {
  members: { user_id: string; full_name: string }[];
  rocks: { id: string; title: string; status: string; owner: string | null }[];
  openMilestones: { id: string; title: string; rock_title: string }[];
  todos: { id: string; title: string; owner: string | null; due_date: string | null }[];
  issues: { title: string; status: string }[];
};

// Snapshot of everything the assistant needs to answer questions and resolve
// proposed actions: rocks, open milestones, open to-dos, open issues, members.
async function loadTeamContext(
  db: FirebaseFirestore.Firestore,
  teamId: string,
): Promise<TeamContext> {
  const members = await getTeamMembers(teamId);
  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));

  const [rocksSnap, todosSnap, issuesSnap] = await Promise.all([
    db.collection("rocks").where("team_id", "==", teamId).get(),
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("completed_at", "==", null)
      .get(),
    db.collection("issues").where("team_id", "==", teamId).get(),
  ]);

  const rocks = rocksSnap.docs.map((d) => {
    const data = d.data() as {
      title: string;
      status: string;
      owner_id: string | null;
    };
    return {
      id: d.id,
      title: data.title,
      status: data.status,
      owner: (data.owner_id && nameById.get(data.owner_id)) || null,
    };
  });
  const rockTitleById = new Map(rocks.map((r) => [r.id, r.title]));

  const openTodos = todosSnap.docs.map((d) => {
    const data = d.data() as {
      title: string;
      owner_id: string | null;
      due_date: string | null;
      source_rock_id: string | null;
    };
    return {
      id: d.id,
      title: data.title,
      owner_id: data.owner_id,
      due_date: data.due_date ?? null,
      source_rock_id: data.source_rock_id ?? null,
    };
  });

  const openMilestones = openTodos
    .filter((t) => t.source_rock_id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      rock_title: rockTitleById.get(t.source_rock_id!) ?? "—",
    }));

  const todos = openTodos
    .filter((t) => !t.source_rock_id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      owner: (t.owner_id && nameById.get(t.owner_id)) || null,
      due_date: t.due_date,
    }));

  const issues = issuesSnap.docs
    .map((d) => {
      const data = d.data() as { title: string; status: string };
      return { title: data.title, status: data.status };
    })
    .filter((i) => i.status === "open");

  return { members, rocks, openMilestones, todos, issues };
}

// Step 1: one chat turn (typed text OR spoken audio) → Gemini → reply plus
// any proposed actions, resolved against the team's live data. Does NOT
// mutate anything; the user confirms via chatCommit.
export async function chatTurn(formData: FormData): Promise<ChatReply> {
  const teamIdRaw = String(formData.get("team_id") ?? "").trim();
  const { uid, name, email } = await requireFirebaseUser();
  const teamId = teamIdRaw || (await firstTeamId(uid));
  if (!teamId) throw new Error("No team available");

  const { db } = await requireTeamAccess(teamId);
  const ctx = await loadTeamContext(db, teamId);

  let history: { role: "user" | "assistant"; text: string }[] = [];
  let pending: ActionItem[] = [];
  try {
    const raw = JSON.parse(String(formData.get("history") ?? "[]"));
    if (Array.isArray(raw)) history = raw.slice(-12);
  } catch {
    // ignore malformed history
  }
  try {
    const raw = JSON.parse(String(formData.get("pending") ?? "[]"));
    if (Array.isArray(raw)) pending = raw;
  } catch {
    // ignore malformed pending proposal
  }

  const audio = formData.get("audio");
  let input;
  if (audio instanceof File && audio.size > 0) {
    if (audio.size > 15 * 1024 * 1024) {
      throw new Error("Recording too long (max ~15MB)");
    }
    const buffer = Buffer.from(await audio.arrayBuffer());
    input = {
      kind: "audio" as const,
      audioBase64: buffer.toString("base64"),
      mimeType: audio.type || "audio/webm",
    };
  } else {
    const text = String(formData.get("text") ?? "").trim();
    if (!text) throw new Error("Empty message");
    input = { kind: "text" as const, text };
  }

  const resp = await chatRespond({
    history,
    input,
    pendingActions: pending,
    context: {
      memberNames: ctx.members
        .map((m) => m.full_name)
        .filter((n) => n && n !== "—"),
      currentUserName: name || email || "me",
      rocks: ctx.rocks,
      openMilestones: ctx.openMilestones,
      todos: ctx.todos,
      issues: ctx.issues,
    },
  });

  // Resolve each proposed action; a failure (e.g. unmatched rock) becomes a
  // note in the reply rather than killing the whole turn.
  // Gemini sometimes resolves a date into its reply but forgets to copy it
  // into the action's due_date field. Recover one from the reply (model
  // normalizes to ISO) or the user's own words as a deterministic backstop.
  const userText =
    input.kind === "text" ? input.text : resp.transcript ?? "";
  const fallbackDue = extractFallbackDate(resp.reply ?? "", userText);

  const items: ResolvedAction[] = [];
  const rawActions: ActionItem[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < resp.actions.length; i++) {
    const a = resp.actions[i];
    const positional = resp.actions.length > 1 ? ` (action ${i + 1})` : "";
    try {
      const resolved = resolveAction(
        a, positional, ctx.rocks, ctx.openMilestones, ctx.todos, ctx.members, uid, name, email, fallbackDue,
      );
      // The model occasionally repeats an identical action; collapse exact dupes.
      const sig = JSON.stringify(resolved);
      if (seen.has(sig)) continue;
      seen.add(sig);
      items.push(resolved);
      rawActions.push(a);
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }

  let reply = (resp.reply ?? "").trim();
  if (!reply && items.length) reply = "Here's what I'll do — confirm to apply.";
  if (notes.length) reply = [reply, ...notes].filter(Boolean).join("\n");

  return { reply, transcript: resp.transcript ?? "", items, rawActions };
}

function resolveAction(
  a: ActionItem,
  positional: string,
  rocks: { id: string; title: string; status: string }[],
  openMilestones: { id: string; title: string; rock_title: string }[],
  openTodos: { id: string; title: string }[],
  members: { user_id: string; full_name: string }[],
  uid: string,
  name: string | null,
  email: string | null,
  fallbackDue: string | null,
): ResolvedAction {
  const owner = resolveOwner(a.owner_name, members, uid, name, email);
  switch (a.action) {
    case "create_todo":
      requireField(a.title, `to-do title${positional}`);
      return {
        action: "create_todo",
        title: a.title!,
        description: a.description,
        due_date: a.due_date ?? fallbackDue,
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
        due_date: a.due_date ?? fallbackDue ?? toDateString(endOfQuarter()),
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
        due_date: a.due_date ?? fallbackDue ?? toDateString(endOfQuarter()),
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
    case "complete_todo": {
      requireField(a.todo_id, `to-do${positional}`);
      const todo = openTodos.find((t) => t.id === a.todo_id);
      if (!todo) {
        throw new Error(
          `Couldn't match an open to-do${positional}. Name it more clearly.`,
        );
      }
      return {
        action: "complete_todo",
        todo_id: todo.id,
        todo_title: todo.title,
      };
    }
  }
}

// Step 2: user confirmed the proposal → apply each item in order. Stops on
// first failure and reports which actions ran. Errors before any commit do
// nothing. This is the human-in-the-loop gate: nothing here runs until the
// user clicks Apply on a proposal.
export async function chatCommit(parsed: ParsedVoice): Promise<CommitResult> {
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
    case "complete_todo": {
      await toggleTodo(teamId, item.todo_id, false);
      paths.add(`/teams/${teamId}/todos`);
      return `Closed to-do: "${item.todo_title}"`;
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
    "complete_todo",
    "create_todo",
  ];
  for (const a of priority) {
    const hit = items.find((i) => i.action === a);
    if (hit) {
      if (a === "create_issue") return `/teams/${teamId}/issues`;
      if (a === "create_todo" || a === "complete_todo")
        return `/teams/${teamId}/todos`;
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
    throw new Error(`Couldn't work out the ${name} — add a bit more detail.`);
  }
}

// Pull the first explicit calendar date out of the given texts, in priority
// order: ISO (YYYY-MM-DD, which the model emits in its reply) then US
// (M/D/YYYY, how users tend to type). Returns a validated YYYY-MM-DD or null.
function extractFallbackDate(...texts: string[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      const d = `${iso[1]}-${iso[2]}-${iso[3]}`;
      if (isRealDate(d)) return d;
    }
    const us = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (us) {
      const d = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      if (isRealDate(d)) return d;
    }
  }
  return null;
}

// Guards against shapes that match the regex but aren't real dates (13/45).
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
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
