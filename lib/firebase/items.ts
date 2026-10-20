// Generic item + viewer loaders (Admin SDK; server only) — what the follow,
// notification and peek code needs to ask `accessFor(type)` a question about
// an `ItemRef` without knowing the type (docs/PERMISSIONS_SPEC.md §5.0).
//
// `loadItem` reads the item through the registry's collection and builds the
// access subject its module reads (a milestone also needs its rock).
// `loadViewers` builds the `Viewer` for any set of people from
// `team_members` plus the admin custom claim, so a recipient's access can be
// checked at send time exactly as theirs would be at read time.

import type { Firestore } from "firebase-admin/firestore";
import {
  accessFor,
  type AccessSubjectFor,
  type Viewer,
} from "@/lib/access";
import {
  itemTypeOfTodoDoc,
  registryFor,
  type ItemRef,
  type ItemType,
} from "@/lib/item-registry";
import { getAdminAuth } from "./admin";
import { feedbackAccessUids } from "./feedback-access";

type Data = Record<string, unknown>;

export type LoadedItem = {
  /** The ref, reclassified: a `todos` doc is a to-do or a milestone by its fields. */
  ref: ItemRef;
  /** The item doc's stored fields. */
  data: Data;
  /** What `accessFor(ref.type)` reads. */
  subject: AccessSubjectFor[ItemType];
  /** The item's parent team (`team_id`), "" if the doc has none. */
  teamId: string;
};

/**
 * The subject the access module for `type` reads, from loaded docs. Pure —
 * exported for tests and for callers that already hold the doc.
 */
export function subjectFor(
  type: ItemType,
  data: Data,
  rock?: Data | null,
  /** A feedback item: the uids of the admins and the people on the tracker's list. */
  feedbackUids?: readonly string[],
): AccessSubjectFor[ItemType] {
  if (type === "feedback") {
    // Only the resolved list: a stored field can never widen access.
    return { access_uids: [...(feedbackUids ?? [])] };
  }
  if (type === "milestone") {
    return {
      milestone: data as AccessSubjectFor["milestone"]["milestone"],
      rock: (rock ?? {
        team_id: String(data.team_id ?? ""),
        owner_id: null,
      }) as AccessSubjectFor["milestone"]["rock"],
    };
  }
  return data as AccessSubjectFor[ItemType];
}

/** `accessFor(type).canSee` on a loaded item, without naming the type. */
export function canSeeItem(item: LoadedItem, viewer: Viewer): boolean {
  return (accessFor(item.ref.type).canSee as (s: unknown, v: Viewer) => boolean)(
    item.subject,
    viewer,
  );
}

/** `accessFor(type).canFollow` on a loaded item. */
export function canFollowItem(item: LoadedItem, viewer: Viewer): boolean {
  return (
    accessFor(item.ref.type).canFollow as (s: unknown, v: Viewer) => boolean
  )(item.subject, viewer);
}

/**
 * Load an item by ref, or null when it does not exist. A ref typed `todo`
 * that points at a milestone (legacy notification rows, the rock modal's
 * `notify` calls) comes back typed `milestone`, and vice versa.
 */
export async function loadItem(
  db: Firestore,
  ref: ItemRef,
  deps: ViewerDeps = {},
): Promise<LoadedItem | null> {
  if (!ref.id) return null;
  const snap = await db.collection(registryFor(ref.type).collection).doc(ref.id).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Data;
  let type: ItemType = ref.type;
  if (type === "todo" || type === "milestone") {
    type = itemTypeOfTodoDoc(data as { source_rock_id?: string | null });
  }
  let rock: Data | null = null;
  if (type === "milestone") {
    const rockSnap = await db
      .collection("rocks")
      .doc(String(data.source_rock_id))
      .get();
    rock = rockSnap.exists ? ((rockSnap.data() ?? {}) as Data) : null;
    // A milestone whose rock is gone is just a to-do on its team.
    if (!rock) type = "todo";
  }
  const feedbackUids =
    type === "feedback"
      ? await (deps.feedbackAccessUids ?? feedbackAccessUids)(db)
      : undefined;
  return {
    ref: { type, id: ref.id },
    data,
    subject: subjectFor(type, data, rock, feedbackUids),
    teamId: typeof data.team_id === "string" ? data.team_id : "",
  };
}

export type ViewerDeps = {
  /** Which of `uids` hold the admin claim. Defaults to an Auth lookup. */
  adminUids?: (uids: string[]) => Promise<Set<string>>;
  /**
   * The uids on the feedback tracker's access list (a feedback item's
   * subject). Defaults to the list + an Auth lookup by email.
   */
  feedbackAccessUids?: (db: Firestore) => Promise<string[]>;
};

async function adminUidsFromAuth(uids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const auth = getAdminAuth();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const u of res.users) {
      if (u.customClaims?.role === "admin") out.add(u.uid);
    }
  }
  return out;
}

/** Viewers for many people: one `team_members` read per 30, one Auth read per 100. */
export async function loadViewers(
  db: Firestore,
  uids: readonly string[],
  deps: ViewerDeps = {},
): Promise<Map<string, Viewer>> {
  const ids = [...new Set(uids.filter(Boolean))];
  const teams = new Map<string, Set<string>>();
  const leads = new Map<string, Set<string>>();
  for (const id of ids) {
    teams.set(id, new Set());
    leads.set(id, new Set());
  }
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db
      .collection("team_members")
      .where("user_id", "in", ids.slice(i, i + 30))
      .get();
    for (const d of snap.docs) {
      const m = d.data() ?? {};
      const uid = String(m.user_id ?? "");
      const teamId = String(m.team_id ?? "");
      if (!teams.has(uid) || !teamId) continue;
      teams.get(uid)!.add(teamId);
      if (m.role === "leader") leads.get(uid)!.add(teamId);
    }
  }
  const admins =
    ids.length > 0 ? await (deps.adminUids ?? adminUidsFromAuth)(ids) : new Set<string>();
  const out = new Map<string, Viewer>();
  for (const id of ids) {
    out.set(id, {
      uid: id,
      isAdmin: admins.has(id),
      teamIds: teams.get(id)!,
      leaderOf: leads.get(id)!,
    });
  }
  return out;
}

/** The Viewer for the signed-in caller, whose admin claim is already known. */
export async function loadViewer(
  db: Firestore,
  uid: string,
  isAdmin: boolean,
): Promise<Viewer> {
  const map = await loadViewers(db, [uid], {
    adminUids: async () => (isAdmin ? new Set([uid]) : new Set()),
  });
  return map.get(uid)!;
}
