// The one thread gate (docs/PERMISSIONS_SPEC.md §5.0–5.2; P9).
//
// Every thread — rock, milestone, to-do, issue, headline — is judged by the
// same two lines: load the item through the registry and ask
// `accessFor(type).canComment` (read and write are one rule, §5.1). No
// branch on the item type lives here. The Admin SDK bypasses
// firestore.rules, so this is the real gate. Missing and forbidden both 404
// (ids stay unenumerable).

import { notFound } from "next/navigation";
import type { Firestore } from "firebase-admin/firestore";
import { accessFor, viewerOf, type Viewer } from "@/lib/access";
import { registryFor, type ThreadEntityType } from "@/lib/item-registry";
import {
  candidatesFromPeople,
  type MentionCandidate,
  type MentionPerson,
} from "@/lib/mentions";
import { visibleToLine } from "@/lib/thread-audience";
import { requireFirebaseUser } from "./auth";
import { getDirectoryPeople, type DirectoryPerson } from "./directory";
import { loadItem, loadViewer, type LoadedItem } from "./items";

export const THREAD_ENTITY_TYPES: readonly ThreadEntityType[] = [
  "issue",
  "rock",
  "todo",
  "headline",
  "feedback",
];

export function isThreadEntityType(v: unknown): v is ThreadEntityType {
  return (THREAD_ENTITY_TYPES as readonly unknown[]).includes(v);
}

type Check = (subject: unknown, viewer: Viewer) => boolean;

/** `accessFor(type).canComment` on a loaded item, without naming the type. */
export function canCommentItem(item: LoadedItem, viewer: Viewer): boolean {
  return (accessFor(item.ref.type).canComment as Check)(item.subject, viewer);
}

/** `accessFor(type).canMention` — can `person` be @mentioned on the item? */
export function canMentionItem(item: LoadedItem, person: Viewer): boolean {
  return (accessFor(item.ref.type).canMention as Check)(item.subject, person);
}

export type ThreadGate = {
  uid: string;
  isAdmin: boolean;
  db: Firestore;
  viewer: Viewer;
  item: LoadedItem;
  /** The item's own team — where its thread, activity and notifications are filed. */
  teamId: string;
};

/** Load the item behind a thread for the signed-in caller and require they may use it. */
export async function requireThreadAccess(
  entityType: ThreadEntityType,
  entityId: string,
): Promise<ThreadGate> {
  if (!isThreadEntityType(entityType)) throw new Error("Bad entity type");
  if (typeof entityId !== "string" || !entityId) notFound();
  const { uid, isAdmin, db } = await requireFirebaseUser();
  const item = await loadItem(db, { type: entityType, id: entityId });
  if (!item) notFound();
  const viewer = await loadViewer(db, uid, isAdmin);
  if (!canCommentItem(item, viewer)) notFound();
  return { uid, isAdmin, db, viewer, item, teamId: item.teamId };
}

/**
 * Everyone in the org who could be named in this thread, each flagged with
 * whether they can see the item (spec §5.2). The list is the directory, not
 * the team roster: an off-team assignee or a rock's audience can be
 * mentioned and can mention.
 */
export function mentionPeopleOf(
  item: LoadedItem,
  people: readonly DirectoryPerson[],
): MentionPerson[] {
  const out: MentionPerson[] = [];
  for (const p of people) {
    const name = `${p.firstName} ${p.lastName}`.trim() || p.email || "";
    if (!name) continue;
    const person = viewerOf(
      p.uid,
      p.access === "admin",
      p.teams.map((t) => t.id),
      p.teams.filter((t) => t.role === "leader").map((t) => t.id),
    );
    out.push({ id: p.uid, name, canSee: canMentionItem(item, person) });
  }
  return out;
}

/**
 * The people the @ picker lists for this item: everyone (the ones who cannot
 * see it greyed), or — for a type whose registry entry says "audience", the
 * feedback tracker — only the people who can see it. The server's mention
 * check still runs against everyone (`mentionPeopleOf`), so a name typed by
 * hand is refused, not resolved, when its person cannot see the item.
 */
export function pickerPeopleOf(
  item: LoadedItem,
  people: readonly MentionPerson[],
): MentionPerson[] {
  return registryFor(item.ref.type).mentionPicker === "audience"
    ? people.filter((p) => p.canSee)
    : [...people];
}

/** Team ids named by the item's access subject (parent team + rock audience). */
function teamIdsOf(item: LoadedItem): string[] {
  const s = item.subject as unknown as Record<string, unknown>;
  const rock = (s.rock ?? s) as Record<string, unknown>;
  const ids = new Set<string>();
  if (item.teamId) ids.add(item.teamId);
  for (const key of ["audience_team_ids", "shared_team_ids"]) {
    const v = rock[key];
    if (Array.isArray(v)) for (const id of v) if (typeof id === "string" && id) ids.add(id);
  }
  return [...ids];
}

/** The "Visible to …" line for the item's thread. */
export async function threadAudienceLine(
  db: Firestore,
  item: LoadedItem,
): Promise<string> {
  const ids = teamIdsOf(item);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const snaps = await db.getAll(...ids.map((id) => db.collection("teams").doc(id)));
    for (const s of snaps) if (s.exists) names.set(s.id, String(s.data()?.name ?? "Team"));
  }
  return visibleToLine(item.ref.type, item.subject, (id) => names.get(id) ?? "the team");
}

export type ThreadContext = {
  /** Picker candidates: everyone, the people who cannot see the item greyed. */
  candidates: MentionCandidate[];
  visibleTo: string;
  /** An admin may delete any comment in the thread. */
  isAdmin: boolean;
};

export async function loadThreadContext(gate: ThreadGate): Promise<ThreadContext> {
  const [people, visibleTo] = await Promise.all([
    getDirectoryPeople(gate.isAdmin).then((d) =>
      pickerPeopleOf(gate.item, mentionPeopleOf(gate.item, d)),
    ),
    threadAudienceLine(gate.db, gate.item),
  ]);
  return {
    candidates: candidatesFromPeople(people),
    visibleTo,
    isAdmin: gate.isAdmin,
  };
}
