import { redirect } from "next/navigation";

/**
 * Import moved to /data/import, which picks its target team from `?team=`
 * instead of the path. Kept as a redirect: the sidebar linked here for months
 * and people have it bookmarked.
 */
export default async function LegacyTeamImportPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  redirect(`/data/import?team=${encodeURIComponent(teamId)}`);
}
