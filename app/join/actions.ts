"use server";

/**
 * Self-serve join requests are retired. Membership is invite-only:
 * org admin creates a team + leader; leaders (or admins) pre-provision members.
 * Kept so old client bundles that still POST here fail cleanly.
 */
export async function requestToJoin(_teamId: string) {
  throw new Error(
    "Self-serve join is disabled. Ask a team leader or administrator to add you.",
  );
}
