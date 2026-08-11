import { CheckCircle2, AlertTriangle, ExternalLink, User } from "lucide-react";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { getTasksStatus, pullCompletionsForOwner } from "@/lib/google/tasks";
import { GoogleTasksActions } from "./google-tasks-actions";

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

      <section className="rounded-xl border border-zinc-300 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-hpb-blue dark:text-hpb-gold">
            <User className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Profile</h2>
            <p className="mt-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {displayName}
            </p>
            {user.email && (
              <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
                {user.email}
              </p>
            )}
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
              Name and email come from your Google sign-in. Contact an admin to
              change account access.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-300 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Google Tasks</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Mirrors to-dos you own into an “EOS · L10 To-Dos” list in your
              Google account. Completing a task in Google Tasks marks it done
              in EOS (two-way completion). Each person connects their own
              account.
            </p>
            <div className="mt-3 text-sm">
              {!status.configured ? (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Not configured on this deployment — set GOOGLE_OAUTH_CLIENT_ID
                  / _SECRET (and GOOGLE_OAUTH_REDIRECT_URI in prod) on the Cloud
                  Run service
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
                      {new Date(status.lastPullAtMs).toLocaleString()}
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
            <GoogleTasksActions connected={status.configured && status.connected} />
          </div>

          {status.configured && (
            <a
              href="/api/google/tasks/connect"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
            >
              <ExternalLink className="h-4 w-4" />
              {status.connected ? "Reconnect" : "Connect"}
            </a>
          )}
        </div>
      </section>
    </div>
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
