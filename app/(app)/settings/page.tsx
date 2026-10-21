import { CheckCircle2, AlertTriangle, ExternalLink, ListChecks, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { getTasksStatus, pullCompletionsForOwner } from "@/lib/google/tasks";
import { SignOutButton } from "@/components/sign-out-button";
import { GoogleTasksActions } from "./google-tasks-actions";
import { LocalTime } from "@/components/local-time";

// Server renders in UTC; timestamps are formatted client-side in the viewer's
// locale and timezone.
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

// Per-user profile + integrations. Google Tasks is two-way on completion:
// EOS → Google on write; Google → EOS via pull (this page, To-Dos, Sync now,
// and the background /api/google/tasks/pull job).
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const user = await requireFirebaseUser();
  const { google } = await searchParams;

  // Best-effort pull so completions land when the user opens Settings.
  // No-ops when OAuth is off or the user hasn't connected.
  await pullCompletionsForOwner(user.uid);

  const status = await getTasksStatus(user.uid);
  const banner = bannerFor(google);

  const displayName =
    user.name?.trim() ||
    user.email ||
    "Signed-in user";

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Your profile and personal integrations.
        </p>
      </header>

      {banner && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${banner.cls}`}
        >
          {banner.icon}
          <span>{banner.text}</span>
        </div>
      )}

      <SettingsCard
        icon={<User className="h-5 w-5" aria-hidden />}
        title="Profile"
        description="Name and email come from your Google sign-in. Contact an admin to change account access."
      >
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-zinc-500 dark:text-zinc-400">Name</dt>
          <dd className="truncate font-medium text-zinc-900 dark:text-zinc-100">
            {displayName}
          </dd>
          {user.email && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Email</dt>
              <dd className="truncate text-zinc-900 dark:text-zinc-100">{user.email}</dd>
            </>
          )}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SignOutButton className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<ListChecks className="h-5 w-5" aria-hidden />}
        title="Google Tasks"
        description="Mirrors to-dos you own into an “EOS · L10 To-Dos” list in your Google account. Completing a task in Google Tasks marks it done in EOS. Each person connects their own account."
        action={
          status.configured ? (
            <a
              href="/api/google/tasks/connect"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
            >
              <ExternalLink className="h-4 w-4" />
              {status.connected || status.revoked ? "Reconnect" : "Connect"}
            </a>
          ) : null
        }
      >
        <div className="text-sm">
          {!status.configured ? (
            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Not configured on this deployment — set GOOGLE_OAUTH_CLIENT_ID
              / _SECRET (and GOOGLE_OAUTH_REDIRECT_URI in prod) on the Cloud
              Run service
            </span>
          ) : status.connected && status.revoked ? (
            <span className="inline-flex flex-col gap-1 text-amber-600 dark:text-amber-400 sm:flex-row sm:items-center sm:gap-1.5">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Reconnect needed — Google revoked access
                {status.email ? ` for ${status.email}` : ""}, so nothing is
                syncing
              </span>
              {status.revokedAtMs != null && (
                <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  · since{" "}
                  <LocalTime ms={status.revokedAtMs} options={DATE_TIME} />
                </span>
              )}
            </span>
          ) : status.connected ? (
            <span className="inline-flex flex-col gap-1 text-hpb-green sm:flex-row sm:items-center sm:gap-1.5">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Connected{status.email ? ` as ${status.email}` : ""}
              </span>
              {status.lastPullAtMs != null && (
                <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  · last sync{" "}
                  <LocalTime ms={status.lastPullAtMs} options={DATE_TIME} />
                </span>
              )}
            </span>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-400">
              Not connected yet — only your own to-dos will sync after you
              connect.
            </span>
          )}
        </div>
        <GoogleTasksActions
          connected={status.configured && status.connected}
          revoked={status.revoked}
        />
      </SettingsCard>
    </div>
  );
}

/**
 * One shell for every settings block: an icon + title + description header
 * with an optional action on the right, a rule, then the body. The body
 * starts at the card's left padding, not under the icon, so the two cards'
 * content lines up down the page.
 */
function SettingsCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card as="section">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-hpb-blue dark:text-hpb-gold">
            {icon}
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">{children}</div>
    </Card>
  );
}

function bannerFor(
  google: string | undefined,
): { cls: string; icon: React.ReactNode; text: string } | null {
  switch (google) {
    case "connected":
      return {
        cls: "bg-hpb-green/10 text-hpb-green",
        icon: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />,
        text: "Google Tasks connected. To-dos you own sync both ways on completion.",
      };
    case "no_refresh":
      return {
        cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />,
        text: "Google didn't return a refresh token. Try Reconnect (it forces re-consent).",
      };
    case "state_error":
      return {
        cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />,
        text: "Sign-in state check failed. Please start the connection again.",
      };
    case "error":
      return {
        cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
        icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />,
        text: "Something went wrong connecting Google Tasks. Check the server logs and try again.",
      };
    default:
      return null;
  }
}
