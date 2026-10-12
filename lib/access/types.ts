// Shared vocabulary for the access modules (docs/PERMISSIONS_SPEC.md §3, §6).
//
// Every item type in the app uses one of four access shapes. Each shape has
// one pure module in this folder; each module answers the same six
// questions for a document's plain fields and a Viewer. No Firestore I/O —
// callers load the document (and the viewer's memberships) and ask.
//
// These modules encode CURRENT production behaviour (main @ 2b1eb5c). Every
// place where docs/PERMISSIONS_SPEC.md says something different carries a
// `// SPEC Pn:` marker naming the build package that will change it
// (docs/PERMISSIONS_BUILD_GRAPH.md). Grep for `SPEC P` to find them all.
//
// The rock module (rock.ts) is live since P6a: rock pages and actions call
// it. The others are still parity wrappers over lib/scorecard-share.ts and
// lib/todo-access.ts until their packages land.

/** The person asking. Build it once per request from the session + roster. */
export type Viewer = {
  uid: string;
  /** Holds the `role: "admin"` custom claim. */
  isAdmin: boolean;
  /** Every team the viewer is rostered on (`team_members`), any role. */
  teamIds: ReadonlySet<string>;
  /** Teams where the viewer's `team_members.role` is `"leader"`. */
  leaderOf: ReadonlySet<string>;
};

/** The four shapes of spec §3. */
export type AccessShape =
  /** A. Issue, headline, team to-do. */
  | "team-item"
  /** B. Private to-do. */
  | "private-item"
  /** C. Rock, milestone. */
  | "rock"
  /** D. Scorecard metric. */
  | "metric";

/** The six item types of spec §5.0. */
export type ItemType =
  | "rock"
  | "milestone"
  | "todo"
  | "issue"
  | "metric"
  | "headline";

/**
 * The common interface each access module implements. `item` is the
 * document's stored fields (whatever the module's subject type needs).
 */
export interface AccessModule<T> {
  /** May the viewer see the item at all (title, body, list rows)? */
  canSee(item: T, viewer: Viewer): boolean;
  /** May the viewer change the item's fields? */
  canEdit(item: T, viewer: Viewer): boolean;
  /** May the viewer read and write in the item's thread? */
  canComment(item: T, viewer: Viewer): boolean;
  /** May the viewer follow the item (get notifications about it)? */
  canFollow(item: T, viewer: Viewer): boolean;
  /**
   * May `person` be @mentioned on the item? By definition (spec §5.2) this
   * is "can `person` see it" — a mention never grants access.
   */
  canMention(item: T, person: Viewer): boolean;
  /** May the viewer delete the item? */
  canDelete(item: T, viewer: Viewer): boolean;
}

/** Items with a done state (to-do / milestone tick, issue solved, headline discussed). */
export interface CompletableAccessModule<T> extends AccessModule<T> {
  canComplete(item: T, viewer: Viewer): boolean;
}

/** Rostered on `teamId` (any role). Admins are NOT implicitly members. */
export function isMemberOf(
  viewer: Viewer,
  teamId: string | null | undefined,
): boolean {
  return typeof teamId === "string" && teamId !== "" && viewer.teamIds.has(teamId);
}

/** Leader of `teamId`. A leader role applies to that one team only (spec §2.4). */
export function isLeaderOf(
  viewer: Viewer,
  teamId: string | null | undefined,
): boolean {
  return (
    typeof teamId === "string" && teamId !== "" && viewer.leaderOf.has(teamId)
  );
}

/**
 * Passes the team gate every team-scoped server action starts with
 * (`requireTeamAccess` + `requireTeamDoc`): rostered on the item's team, or
 * an org admin (who may open any team).
 */
export function passesTeamGate(
  viewer: Viewer,
  teamId: string | null | undefined,
): boolean {
  return viewer.isAdmin || isMemberOf(viewer, teamId);
}

/** `id` is a non-empty string equal to the viewer's uid. */
export function isViewer(viewer: Viewer, id: unknown): boolean {
  return typeof id === "string" && id !== "" && id === viewer.uid;
}

/** Build a Viewer from plain lists (pages pass these across the RSC boundary). */
export function viewerOf(
  uid: string,
  isAdmin: boolean,
  teamIds: Iterable<string>,
  leaderOf: Iterable<string> = [],
): Viewer {
  return {
    uid,
    isAdmin,
    teamIds: new Set(teamIds),
    leaderOf: new Set(leaderOf),
  };
}
