import { requireAdmin } from "@/lib/firebase/teams";
import { listFeedbackItems } from "@/lib/firebase/feedback";
import { AdminHeader } from "../admin-header";
import { FeedbackTracker } from "./feedback-tracker";

/**
 * Feedback tracker (ROADMAP N73): HPB staff feedback on the app, worked by
 * the org admins. Admin-only — requireAdmin() 404s anyone else, as on every
 * admin page, and listFeedbackItems() checks again.
 *
 * `?view=board` shows the kanban; the list is the default.
 */
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const [items, sp] = await Promise.all([listFeedbackItems(), searchParams]);
  const view = sp.view === "board" ? "board" : "list";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminHeader
        title="Feedback tracker"
        blurb="Reported problems and requests from HPB staff, seeded from the HPB feedback spreadsheet. Admins only."
      />
      <FeedbackTracker items={items} view={view} />
    </div>
  );
}
