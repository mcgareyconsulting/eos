import { redirect } from "next/navigation";
import { requireFirebaseUser } from "@/lib/firebase/auth";

/**
 * Legacy /join route. Self-serve "request to join" is retired — membership
 * is invite-only (admin creates team + leader; leaders invite members).
 * Sends everyone into Directory (or Home if already on a team).
 */
export default async function JoinPage() {
  const { uid, db } = await requireFirebaseUser();

  const myMemberships = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .limit(1)
    .get();
  if (!myMemberships.empty) redirect("/home");

  redirect("/directory");
}
