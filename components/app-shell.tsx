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
    <div className="flex min-h-screen">
      <aside className="relative w-60 shrink-0 border-r border-zinc-200 bg-white">
        <div className="px-4 py-5 border-b border-zinc-200">
          <Link href="/my90" className="text-lg font-semibold tracking-tight">
            High Plains Bank
          </Link>
        </div>

        <nav className="px-2 py-3 space-y-0.5">
          <NavLink href="/my90" icon={Home} label="My 90" />
        </nav>

        {team && (
          <div className="px-2 py-3 border-t border-zinc-200">
            <div className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
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

        <div className="absolute bottom-0 w-60 border-t border-zinc-200 bg-white px-4 py-3">
          <div className="text-sm font-medium text-zinc-900 truncate">
            {displayName}
          </div>
          <form action={signOut} className="mt-1">
            <button
              type="submit"
              className="text-xs text-zinc-500 hover:text-zinc-900 underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
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
      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-zinc-700 hover:bg-zinc-100"
    >
      <Icon className="w-4 h-4 text-zinc-500" />
      <span>{label}</span>
    </Link>
  );
}
