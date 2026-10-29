"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * True when `pathname` is `href` or a page under it — /teams/t1/meetings
 * stays lit inside /teams/t1/meetings/m9.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar row (app shell + team nav). The current page's icon takes the brand color. */
export function SidebarLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const active = isActivePath(usePathname() ?? "", href);
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 group-data-[sidebar-collapsed]/shell:justify-center group-data-[sidebar-collapsed]/shell:py-2 dark:text-zinc-300 dark:hover:bg-zinc-800",
        active && "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 group-data-[sidebar-collapsed]/shell:size-5",
          active ? "text-hpb-blue dark:text-hpb-gold" : "text-zinc-600 dark:text-zinc-400",
        )}
      />
      <span className="group-data-[sidebar-collapsed]/shell:hidden">{label}</span>
    </Link>
  );
}
