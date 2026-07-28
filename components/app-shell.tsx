import Link from "next/link";
import {
  Home,
  BarChart3,
  Target,
  CheckSquare,
  AlertCircle,
  Megaphone,
  Calendar,
  Users,
  Plug,
} from "lucide-react";
import { signOut } from "@/app/(app)/sign-out-action";
import { ThemeToggle } from "@/components/theme-toggle";
import { EnvBanner } from "@/components/env-badge";

type Team = { id: string; name: string };
type Profile = {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
} | null;

export function AppShell({
  user,
  profile,
  team,
  children,
}: {
  user: { email?: string | null };
  profile: Profile;
  team: Team | null;
  children: React.ReactNode;
}) {
  const displayName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "";
  const teamPath = team ? `/teams/${team.id}` : null;

  const teamNav = teamPath
    ? [
        { href: `${teamPath}/scorecard`, label: "Scorecard", icon: BarChart3 },
        { href: `${teamPath}/rocks`, label: "Rocks", icon: Target },
        { href: `${teamPath}/todos`, label: "To-Dos", icon: CheckSquare },
        { href: `${teamPath}/issues`, label: "Issues", icon: AlertCircle },
        { href: `${teamPath}/headlines`, label: "Headlines", icon: Megaphone },
        { href: `${teamPath}/meetings`, label: "Meetings", icon: Calendar },
        { href: `${teamPath}/members`, label: "Members", icon: Users },
      ]
    : [];

  return (
    // Column wrapper so the environment banner can span the full width above
    // both the sidebar and the main pane. Without a label it renders nothing
    // and this collapses to the original single-row layout.
    <div className="group/shell flex h-screen flex-col overflow-hidden">
      <EnvBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Focus mode: a page can drop the global nav and widen the content
            by rendering `<div data-meeting-focus hidden />` anywhere inside
            (the live L10 does). Driven by :has() off the page's own markup
            rather than by usePathname, deliberately — the router updates the
            pathname optimistically the moment a navigation starts, so a
            path-based rule tore the nav away while the PREVIOUS page was
            still on screen, then swapped the page a beat later. */}
        <aside className="relative flex w-60 shrink-0 flex-col border-r border-zinc-300 bg-white group-has-[[data-meeting-focus]]/shell:hidden dark:border-zinc-800 dark:bg-zinc-900">
          <div className="px-4 py-5 border-b border-zinc-300 dark:border-zinc-800">
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
            <nav className="px-2 py-3 space-y-0.5">
              <NavLink href="/home" icon={Home} label="Home" />
              <NavLink href="/integrations" icon={Plug} label="Integrations" />
            </nav>

            {team && (
              <div className="px-2 py-3 border-t border-zinc-300 dark:border-zinc-800">
                <div className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  {team.name}
                </div>
                <div className="space-y-0.5">
                  {teamNav.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {displayName}
                </div>
                <form action={signOut} className="mt-0.5">
                  <button
                    type="submit"
                    className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
                  >
                    Sign out
                  </button>
                </form>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          {/* Wider in focus mode so the Scorecard's 13 week columns get room,
              but still capped — an uncapped meeting screen stretches the
              Segue roster into a row of islands on a 27" monitor. */}
          <div className="mx-auto max-w-6xl px-8 py-8 group-has-[[data-meeting-focus]]/shell:max-w-[1600px] group-has-[[data-meeting-focus]]/shell:px-6 group-has-[[data-meeting-focus]]/shell:py-6">
            {children}
          </div>
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
      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <Icon className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
      <span>{label}</span>
    </Link>
  );
}
