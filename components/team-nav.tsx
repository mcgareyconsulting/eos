"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Target,
  CheckSquare,
  AlertCircle,
  Megaphone,
  Calendar,
  Users,
  Upload,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/initials";
import {
  setSidebarCollapsed,
  useSidebarCollapsed,
} from "@/components/sidebar-collapse-toggle";

export type ShellTeam = { id: string; name: string };

const PREFERRED_TEAM_KEY = "eos:active-team-id";

/** Matches the anchored menu's max-h-64; used to keep the flyout on screen. */
const FLYOUT_MAX_H = 256;

const TEAM_SECTIONS = [
  "scorecard",
  "rocks",
  "todos",
  "issues",
  "headlines",
  "meetings",
  "members",
  "import",
] as const;

type TeamSection = (typeof TEAM_SECTIONS)[number];

const NAV_ITEMS: {
  section: TeamSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { section: "scorecard", label: "Scorecard", icon: BarChart3 },
  { section: "rocks", label: "Rocks", icon: Target },
  { section: "todos", label: "To-Dos", icon: CheckSquare },
  { section: "issues", label: "Issues", icon: AlertCircle },
  { section: "headlines", label: "Headlines", icon: Megaphone },
  { section: "meetings", label: "Meetings", icon: Calendar },
  { section: "members", label: "Members", icon: Users },
  { section: "import", label: "Import", icon: Upload },
];

function parseTeamRoute(pathname: string): {
  teamId: string | null;
  section: TeamSection | null;
} {
  const match = pathname.match(/^\/teams\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return { teamId: null, section: null };
  const teamId = match[1] ?? null;
  const raw = match[2] ?? null;
  const section =
    raw && (TEAM_SECTIONS as readonly string[]).includes(raw)
      ? (raw as TeamSection)
      : null;
  return { teamId, section };
}

function pathForTeam(
  teamId: string,
  section: TeamSection | null,
  pathname: string,
): string {
  // Deep meeting routes don't transfer across teams — land on the list.
  if (pathname.includes("/meetings/")) {
    return `/teams/${teamId}/meetings`;
  }
  return `/teams/${teamId}/${section ?? "scorecard"}`;
}

function readPreferredTeamId(teamIds: Set<string>, fallback: string): string {
  try {
    const stored = localStorage.getItem(PREFERRED_TEAM_KEY);
    if (stored && teamIds.has(stored)) return stored;
  } catch {
    // private mode / SSR-adjacent
  }
  return fallback;
}

function writePreferredTeamId(teamId: string) {
  try {
    localStorage.setItem(PREFERRED_TEAM_KEY, teamId);
  } catch {
    // ignore quota / private mode
  }
}

let preferredListeners = new Set<() => void>();

function subscribePreferred(cb: () => void) {
  preferredListeners.add(cb);
  return () => {
    preferredListeners.delete(cb);
  };
}

function notifyPreferred() {
  for (const cb of preferredListeners) cb();
}

/**
 * Sidebar team block: current team label (click → switcher when multi-team)
 * plus team-scoped nav links. Active team comes from the URL when on a
 * /teams/[id]/… route, otherwise the last chosen team (localStorage).
 */
export function TeamNav({
  teams,
  importTeamIds = [],
}: {
  teams: ShellTeam[];
  /** Teams whose Import page this user may open (leaders + admin god-mode);
   *  the Import link hides for other teams — the page itself 404s regardless. */
  importTeamIds?: string[];
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { teamId: pathTeamId, section: pathSection } = parseTeamRoute(pathname);

  const sorted = [...teams].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const membershipKey = sorted.map((t) => t.id).join(",");
  const fallbackId = sorted[0]?.id ?? "";

  const preferredId = useSyncExternalStore(
    subscribePreferred,
    () =>
      readPreferredTeamId(
        new Set(membershipKey ? membershipKey.split(",") : []),
        fallbackId,
      ),
    () => fallbackId,
  );

  const isMember = useCallback(
    (id: string | null | undefined): id is string =>
      Boolean(id && membershipKey.split(",").includes(id)),
    [membershipKey],
  );

  // URL wins when it points at a team the user belongs to.
  const activeId = isMember(pathTeamId)
    ? pathTeamId
    : preferredId || fallbackId;
  const activeTeam = sorted.find((t) => t.id === activeId) ?? sorted[0] ?? null;

  // Keep preference aligned when navigating into a team via home links etc.
  useEffect(() => {
    if (isMember(pathTeamId) && pathTeamId !== preferredId) {
      writePreferredTeamId(pathTeamId);
      notifyPreferred();
    }
  }, [pathTeamId, preferredId, isMember]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const multi = sorted.length > 1;
  const collapsed = useSidebarCollapsed();

  // Collapsed, the menu can't live in normal flow: the sidebar's scroll
  // container clips it vertically and the 16-wide rail clips it horizontally.
  // Position it `fixed` beside the rail button instead of expanding the
  // sidebar out from under the click.
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !collapsed) {
      setFlyout(null);
      return;
    }
    const place = () => {
      const rect = railRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Keep the menu on screen — the team block sits near the sidebar's foot.
      const top = Math.max(
        8,
        Math.min(rect.top, window.innerHeight - FLYOUT_MAX_H - 8),
      );
      setFlyout({ top, left: rect.right + 8 });
    };
    place();
    window.addEventListener("resize", place);
    // Capture: the sidebar's own scroller moves the anchor, and scroll
    // events from it don't bubble to window.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, collapsed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const selectTeam = useCallback(
    (teamId: string) => {
      if (!isMember(teamId)) return;
      writePreferredTeamId(teamId);
      notifyPreferred();
      setOpen(false);

      if (pathTeamId) {
        // Stay in the same section on the other team.
        router.push(pathForTeam(teamId, pathSection, pathname));
      }
      // On /home or /settings, only the nav target team changes.
    },
    [isMember, pathSection, pathTeamId, pathname, router],
  );

  if (!activeTeam) return null;

  const teamPath = `/teams/${activeTeam.id}`;

  return (
    <div className="px-2 py-3 border-t border-zinc-300 dark:border-zinc-800">
      <div className="relative px-0 pb-2" ref={rootRef}>
        {/* Collapsed rail. With several teams this opens the switcher as a
            fixed flyout beside the rail — the sidebar stays collapsed. With
            one team there's no menu, so the button just expands. */}
        <button
          ref={railRef}
          type="button"
          {...(multi
            ? {
                "aria-haspopup": "listbox" as const,
                "aria-expanded": open,
                "aria-controls": listId,
              }
            : {})}
          className={cn(
            "mx-auto hidden h-8 w-8 items-center justify-center rounded-md",
            "text-xs font-semibold text-hpb-blue dark:text-hpb-gold",
            "bg-hpb-blue/10 hover:bg-hpb-blue/20 dark:bg-hpb-gold/10 dark:hover:bg-hpb-gold/20",
            "group-data-[sidebar-collapsed]/shell:flex",
          )}
          title={multi ? `Switch team — ${activeTeam.name}` : activeTeam.name}
          aria-label={multi ? "Switch team" : `Team: ${activeTeam.name}`}
          onClick={() => {
            if (multi) setOpen((v) => !v);
            else setSidebarCollapsed(false);
          }}
        >
          {initials(activeTeam.name) || "?"}
        </button>
        {multi ? (
          <>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-1 rounded-md px-2 py-1 text-left",
                "group-data-[sidebar-collapsed]/shell:hidden",
                "text-xs font-medium uppercase tracking-wide",
                "text-zinc-600 dark:text-zinc-400",
                "hover:bg-zinc-100 hover:text-zinc-900",
                "dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
              )}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="min-w-0 flex-1 truncate">{activeTeam.name}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            {open && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Switch team"
                style={
                  flyout
                    ? {
                        top: flyout.top,
                        left: flyout.left,
                        maxHeight: FLYOUT_MAX_H,
                      }
                    : undefined
                }
                className={cn(
                  "z-50 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg",
                  "dark:border-zinc-700 dark:bg-zinc-900",
                  flyout
                    ? "fixed w-56"
                    : "absolute left-0 right-0 mt-1 max-h-64",
                  // One frame can land with the menu open and collapsed but
                  // unmeasured; don't flash it inside the 16-wide rail.
                  collapsed && !flyout && "hidden",
                )}
              >
                {sorted.map((t) => {
                  const selected = t.id === activeTeam.id;
                  return (
                    <li key={t.id} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                          "text-zinc-800 dark:text-zinc-200",
                          "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                          selected && "font-medium",
                        )}
                        onClick={() => selectTeam(t.id)}
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            selected
                              ? "text-hpb-blue dark:text-hpb-gold"
                              : "opacity-0",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate normal-case tracking-normal">
                          {t.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <div className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-600 group-data-[sidebar-collapsed]/shell:hidden dark:text-zinc-400">
            {activeTeam.name}
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        {NAV_ITEMS.filter(
          (item) =>
            item.section !== "import" || importTeamIds.includes(activeTeam.id),
        ).map((item) => (
          <NavLink
            key={item.section}
            href={`${teamPath}/${item.section}`}
            icon={item.icon}
            label={item.label}
          />
        ))}
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
      title={label}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 group-data-[sidebar-collapsed]/shell:justify-center"
    >
      <Icon className="w-4 h-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
      <span className="group-data-[sidebar-collapsed]/shell:hidden">{label}</span>
    </Link>
  );
}
