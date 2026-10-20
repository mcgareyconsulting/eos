// Feedback tracker items (ROADMAP N73) — not one of the four team shapes.
//
// Access is the tracker's dedicated list (app_config/feedback_tracker; see
// lib/feedback/access.ts), keyed by email, not by team or the admin role: an
// org admin who is not listed gets nothing, and everyone listed gets the
// same full access. The list is resolved to uids when the item is loaded
// (lib/firebase/items.ts `loadItem` → lib/firebase/feedback-access.ts
// `feedbackAccessUids`: the Auth accounts whose verified email is on the
// list), and carried on the subject, so every question here stays the same
// pure `(subject, viewer)` call as for every other type — and a mention
// resolved against the Directory, or a recipient checked at send time, is
// judged by exactly the rule the caller was.
//
// Fails closed: a subject without `access_uids` (a doc read some other way)
// lets nobody in.

import type { AccessModule, Viewer } from "./types";

export type FeedbackSubject = {
  /** Uids on the tracker's access list, resolved at load time. */
  access_uids?: readonly string[];
};

function listed(item: FeedbackSubject, viewer: Viewer): boolean {
  const uids = item.access_uids;
  return Array.isArray(uids) && typeof viewer.uid === "string" && viewer.uid !== "" && uids.includes(viewer.uid);
}

export const feedbackAccess: AccessModule<FeedbackSubject> = {
  canSee: listed,
  canEdit: listed,
  // Read and write are one rule for threads (spec §5.1).
  canComment: listed,
  // Not followable: a follow is stored on the item doc (`follower_ids`),
  // and a tracker item is written only through lib/firebase/feedback.ts,
  // one transaction with its activity row and the edit form's staleness
  // check on `updated_at`. Comment notifications go to the people a comment
  // mentions (lib/item-registry.ts `feedback`).
  canFollow: () => false,
  // A mention never grants access (spec §5.2).
  canMention: listed,
  // Items are never deleted from the tracker.
  canDelete: () => false,
};
