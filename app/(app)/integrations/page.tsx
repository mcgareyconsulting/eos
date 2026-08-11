import { redirect } from "next/navigation";

// Integrations live under Settings / profile (P3-4). Keep this path so old
// bookmarks and docs land in the right place; preserve OAuth status query.
export default async function IntegrationsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
  if (google) {
    redirect(`/settings?google=${encodeURIComponent(google)}`);
  }
  redirect("/settings");
}
