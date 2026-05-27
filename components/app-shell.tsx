import Link from "next/link";
import {
  Home,
  BarChart3,
  Target,
  CheckSquare,
  AlertCircle,
  Megaphone,
  Calendar,
} from "lucide-react";
import { signOut } from "@/app/(app)/sign-out-action";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoiceCreateButton } from "@/components/voice-create-button";

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
      ]
    : [];

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="relative flex w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="px-4 py-5 border-b border-zinc-200 dark:border-zinc-800">
          <Link href="/my90" className="block">
            <span className="block text-base font-bold uppercase tracking-wide text-hpb-blue dark:text-hpb-gold">
              High Plains Bank
            </span>
            <span className="mt-0.5 block text-[10px] italic text-zinc-500 dark:text-zinc-400">
              Employee Owned • Community Driven
            </span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <nav className="px-2 py-3 space-y-0.5">
            <NavLink href="/my90" icon={Home} label="My 90" />
          </nav>

          {team && (
            <div className="px-2 py-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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

        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {displayName}
              </div>
              <form action={signOut} className="mt-0.5">
                <button
                  type="submit"
                  className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
                >
                  Sign out
                </button>
              </form>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>

      <VoiceCreateButton teamId={team?.id ?? null} />
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
      <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
      <span>{label}</span>
    </Link>
  );
}
