import { requireFeedbackTrackerAccess } from "@/lib/firebase/feedback-access";
import { getFeedbackItem, listFeedbackActivity, listFeedbackItems } from "@/lib/firebase/feedback";
import { loadUserNames } from "@/lib/firebase/user-names";
import { SYSTEM_ACTOR_ID } from "@/lib/activity";
import { isFeedbackDocId } from "@/lib/feedback/model";
import { AdminHeader } from "../admin-header";
import type { FeedbackDetailData } from "./feedback-detail-modal";
import { FeedbackTracker } from "./feedback-tracker";

/**
 * Feedback tracker (ROADMAP N73): HPB staff feedback on the app, worked by
 * org admins and the people on its access list (app_config/feedback_tracker,
 * `pnpm feedback:access`). requireFeedbackTrackerAccess() 404s anyone else,
 * and every read below checks again.
 *
 *   ?view=board   the kanban; the list is the default
 *   ?item=fb-037  that item open in the detail modal (deep-linkable); its
 *                 activity and actor names are loaded here
 */
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { db, uid } = await requireFeedbackTrackerAccess();
  const [items, sp] = await Promise.all([listFeedbackItems(), searchParams]);
  const view = sp.view === "board" ? "board" : "list";
  const itemParam = typeof sp.item === "string" && sp.item !== "" ? sp.item : null;

  let detail: FeedbackDetailData | null = null;
  if (itemParam && isFeedbackDocId(itemParam)) {
    const item = await getFeedbackItem(itemParam);
    if (item) {
      const activity = await listFeedbackActivity(item.id);
      const names = await loadUserNames(
        db,
        activity.map((a) => a.actor_uid).filter((uid) => uid !== SYSTEM_ACTOR_ID),
      );
      detail = { item, activity, actorNames: Object.fromEntries(names) };
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminHeader
        title="Feedback tracker"
        eyebrow="Restricted"
        blurb="Reported problems and requests from HPB staff, seeded from the HPB feedback spreadsheet. Only the people on the tracker's access list can open it."
      />
      <FeedbackTracker items={items} view={view} itemParam={itemParam} detail={detail} userId={uid} />
    </div>
  );
}
