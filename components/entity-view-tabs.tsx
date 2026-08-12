import Link from "next/link";
import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared Active | Archived toggle for entity tabs (Rocks, To-Dos, Issues).
 * Selected state is the black pill used on To-Dos / Issues.
 */
export function EntityViewTabs({
  basePath,
  showArchived,
  activeCount,
  archivedCount,
  owner,
}: {
  basePath: string;
  showArchived: boolean;
  activeCount: number;
  archivedCount: number;
  /** Preserve an owner filter across Active / Archived. */
  owner?: string;
}) {
  const ownerQs = owner ? `owner=${owner}` : "";
  const activeHref = ownerQs ? `${basePath}?${ownerQs}` : basePath;
  const archivedHref = ownerQs
    ? `${basePath}?archived=1&${ownerQs}`
    : `${basePath}?archived=1`;

  const selected =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900";
  const idle =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm tabular-nums text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

  return (
    <div className="inline-flex items-center gap-1">
      <Link
        href={activeHref}
        className={cn("min-w-[6.75rem]", !showArchived ? selected : idle)}
      >
        Active ({activeCount})
      </Link>
      <Link
        href={archivedHref}
        className={cn("min-w-[8.5rem]", showArchived ? selected : idle)}
      >
        <Archive className="h-3.5 w-3.5" />
        Archived ({archivedCount})
      </Link>
    </div>
  );
}
