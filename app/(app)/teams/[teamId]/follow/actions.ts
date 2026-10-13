"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { loadViewer } from "@/lib/firebase/items";
import { setFollowingAs } from "@/lib/firebase/follow";
import { recordActivity } from "@/lib/firebase/activity";
import { isItemType, type ItemRef } from "@/lib/item-registry";

/**
 * Follow or unfollow any item (docs/PERMISSIONS_SPEC.md §5.3).
 *
 * Gated by `accessFor(type).canFollow` against the caller's Viewer — not by
 * `teamId`, which only names the page to refresh (an off-team assignee
 * follows from their own team's page). An item the caller cannot see is
 * "not found"; the owner and the current assigner cannot unfollow.
 */
export async function setFollowing(
  ref: ItemRef,
  teamId: string,
  follow: boolean,
): Promise<void> {
  if (!ref || !isItemType(ref.type) || typeof ref.id !== "string" || !ref.id) {
    throw new Error("Bad item");
  }
  const { uid, isAdmin, db } = await requireFirebaseUser();
  const viewer = await loadViewer(db, uid, isAdmin);
  const r = await setFollowingAs(db, { type: ref.type, id: ref.id }, viewer, follow === true);
  if (!r.ok) {
    if (r.reason === "not_found") notFound();
    if (r.reason === "locked") {
      throw new Error("The owner and the assigner always follow this item");
    }
    throw new Error("You can't follow this item");
  }

  // The activity trace is a to-do feature (milestones are to-dos).
  const item = r.item;
  if (r.changed && (item.ref.type === "todo" || item.ref.type === "milestone")) {
    await recordActivity({
      db,
      teamId: item.teamId || teamId,
      entity: {
        type: "todo",
        id: item.ref.id,
        visibility: item.data.visibility as string | undefined,
        ownerId: item.data.owner_id as string | null | undefined,
      },
      kind: follow ? "followed" : "unfollowed",
      actor: { id: uid },
    });
  }
  for (const t of new Set([teamId, item.teamId].filter(Boolean))) {
    revalidatePath(`/teams/${t}/todos`);
    revalidatePath(`/teams/${t}/meetings`);
    if (item.ref.type === "metric") revalidatePath(`/teams/${t}/scorecard`);
    if (item.ref.type !== "todo") {
      revalidatePath(`/teams/${t}/rocks`);
      revalidatePath(`/teams/${t}/issues`);
    }
  }
}
