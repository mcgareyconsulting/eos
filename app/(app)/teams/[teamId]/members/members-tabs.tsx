import Link from "next/link";
import { cn } from "@/lib/utils";

export type MembersTab = "team" | "directory";

export function MembersTabs({
  teamId,
  active,
}: {
  teamId: string;
  active: MembersTab;
}) {
  const base = `/teams/${teamId}/members`;
  const items: { id: MembersTab; label: string; href: string }[] = [
    { id: "team", label: "This team", href: base },
    {
      id: "directory",
      label: "All teams",
      href: `${base}?tab=directory`,
    },
  ];

  return (
    <nav
      className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      aria-label="Members sections"
    >
      {items.map((item) => {
        const selected = active === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              selected
                ? "border-hpb-blue text-hpb-blue dark:border-hpb-gold dark:text-hpb-gold"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
            aria-current={selected ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
