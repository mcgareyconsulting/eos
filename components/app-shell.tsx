import Link from "next/link";
import { Home, Plug, Shield } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { EnvBanner } from "@/components/env-badge";
import { LiveAuthBanner } from "@/components/live-auth-banner";
import { SignOutButton } from "@/components/sign-out-button";
import { TeamNav, type ShellTeam } from "@/components/team-nav";

type Profile = {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
} | null;

export function AppShell({
  user,
  profile,
  teams,
  isAdmin = false,
  membershipCount = 0,
  children,
}: {
  user: { email?: string | null };
  profile: Profile;
  /** Teams the sidebar can open for data (memberships, or all teams if admin). */
  teams: ShellTeam[];
  isAdmin?: boolean;
  /** Real membership count (may be 0 for admin with god-mode only). */
  membershipCount?: number;
  children: React.ReactNode;
}) {
  const displayName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "";

  return (
    <div className="group/shell flex h-screen flex-col overflow-hidden">
      <EnvBanner />
      <LiveAuthBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="relative flex w-60 shrink-0 flex-col border-r border-zinc-300 bg-white group-has-[[data-meeting-focus]]/shell:hidden dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-300 px-4 py-5 dark:border-zinc-800">
            <Link href="/home" className="block">
              <span className="block text-base font-bold uppercase tracking-wide text-hpb-blue dark:text-hpb-gold">
                High Plains Bank
              </span>
              <span className="mt-0.5 block text-[10px] italic text-zinc-600 dark:text-zinc-400">
                Employee Owned • Community Driven
              </span>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto">
            <nav className="space-y-0.5 px-2 py-3">
              <NavLink href="/home" icon={Home} label="Home" />
              <NavLink href="/integrations" icon={Plug} label="Integrations" />
            </nav>

            {membershipCount === 0 && !isAdmin && (
              <div className="mx-2 mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                You&apos;re not on a team yet. Open{" "}
                <Link href="/directory" className="font-medium underline">
                  Members directory
                </Link>{" "}
                — a leader will add you when ready.
              </div>
            )}

            {membershipCount === 0 && isAdmin && teams.length === 0 && (
              <div className="mx-2 mb-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] leading-snug text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                No teams yet.{" "}
                <Link
                  href="/directory/new"
                  className="font-medium text-hpb-blue underline dark:text-hpb-gold"
                >
                  Create a team
                </Link>
                .
              </div>
            )}

            {teams.length > 0 && <TeamNav teams={teams} />}
          </div>

          <div className="border-t border-zinc-300 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {displayName}
                  </div>
                  {isAdmin && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-hpb-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-hpb-blue dark:text-hpb-gold"
                      title="Org admin"
                    >
                      <Shield className="h-2.5 w-2.5" />
                      Admin
                    </span>
                  )}
                </div>
                <SignOutButton className="mt-0.5 text-xs text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100" />
              </div>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <div className="max-w-[1600px] px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
      <span>{label}</span>
    </Link>
  );
}
