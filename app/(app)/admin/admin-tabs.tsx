import Link from "next/link";
import { cn } from "@/lib/utils";

export type AdminTab = "people" | "teams" | "import";

const ITEMS: { id: AdminTab; label: string; href: string }[] = [
  { id: "people", label: "People", href: "/admin/people" },
  { id: "teams", label: "Teams", href: "/admin/teams" },
  { id: "import", label: "Import seed file", href: "/admin/import" },
];

export function AdminTabs({ active }: { active: AdminTab }) {
  return (
    <nav
      className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      aria-label="Admin sections"
    >
      {ITEMS.map((item) => {
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

export function AdminHeader({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <header>
      <div className="flex items-center gap-2 text-hpb-blue dark:text-hpb-gold">
        <span className="text-xs font-semibold uppercase tracking-wide">
          Org admin
        </span>
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        {blurb}
      </p>
    </header>
  );
}
