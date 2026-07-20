import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { getTasksStatus } from "@/lib/google/tasks";

// Single-user integrations surface. Currently: the Google Tasks connector
// (one-way push of L10 to-dos → Google Tasks). One connected account for the
// whole app — see lib/google/tasks.ts for the scope rationale.
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  await requireFirebaseUser(); // gate on a valid session
  const { google } = await searchParams;
  const status = await getTasksStatus();

  const banner = bannerFor(google);

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Connect external services. Connections are app-wide (single account).
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

      <section className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Google Tasks</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Pushes every L10 to-do into an “EOS · L10 To-Dos” list in the
              connected Google account. One-way (EOS → Google Tasks).
            </p>
            <div className="mt-3 text-sm">
              {!status.configured ? (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Not configured — set GOOGLE_OAUTH_CLIENT_ID / _SECRET
                </span>
              ) : status.connected ? (
                <span className="inline-flex items-center gap-1.5 text-hpb-green">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected{status.email ? ` as ${status.email}` : ""}
                </span>
              ) : (
                <span className="text-zinc-600 dark:text-zinc-400">
                  Not connected yet.
                </span>
              )}
            </div>
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
        text: "Google Tasks connected. New and updated to-dos will now sync.",
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
