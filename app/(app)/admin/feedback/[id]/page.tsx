import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/firebase/teams";
import { isFeedbackDocId } from "@/lib/feedback/model";
import { feedbackTrackerHref } from "@/lib/feedback/view";

/**
 * Old link shape. An item now opens as a modal over the tracker
 * (/admin/feedback?item=fb-037), so this only redirects there — admin-gated
 * first, so anyone else gets the same 404 as every admin page.
 */
export default async function FeedbackItemRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!isFeedbackDocId(id)) notFound();
  redirect(feedbackTrackerHref({ view: "list", item: id }));
}
