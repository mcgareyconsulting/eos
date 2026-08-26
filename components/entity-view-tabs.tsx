import Link from "next/link";
import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";

const selected =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900";
const idle =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm tabular-nums text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

/** Shared labels so the tab and in-meeting toggles can never drift apart. */
function ActiveLabel({ count }: { count: number }) {
  return <>Active ({count})</>;
}
function ArchivedLabel({ count }: { count: number }) {
  return (
    <>
      <Archive className="h-3.5 w-3.5" />
      Archived ({count})
    </>
  );
}

/**
 * Active | Archived toggle for entity tabs (Rocks, To-Dos, Issues, Headlines).
 *
 * Navigational: the standalone tabs put the view in the URL (`?archived=1`)
 * and re-render on the server. In the L10 the same control is local state —
 * see `EntityViewToggle`, which shares this component's look exactly.
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

  return (
    <div className="inline-flex items-center gap-1">
      <Link
        href={activeHref}
        className={cn("min-w-[6.75rem]", !showArchived ? selected : idle)}
      >
        <ActiveLabel count={activeCount} />
      </Link>
      <Link
        href={archivedHref}
        className={cn("min-w-[8.5rem]", showArchived ? selected : idle)}
      >
        <ArchivedLabel count={archivedCount} />
      </Link>
    </div>
  );
}

/**
 * The same control, driven by local state instead of the URL (N24, L10 half).
 *
 * The meeting page cannot use the navigational version: it already owns
 * `?view=`, `?recap=1`, `?weeks=` and `?period=`, one `?archived=` would be
 * ambiguous across four segments, and — since N27 — an auto re-attach does
 * `router.replace(pathname)`, which would silently reset a viewer's Archived
 * view back to Active mid-meeting. Local state also costs nothing to read:
 * every segment already subscribes to the team's whole collection and filters
 * archived rows in memory, so the rows are on the client either way.
 *
 * Resets when the segment unmounts, by design (daniel, 2026-08-26) — Active is
 * the right default for a room, and a remembered Archived view would read as
 * "the team's issues vanished".
 */
export function EntityViewToggle({
  showArchived,
  onChange,
  activeCount,
  archivedCount,
}: {
  showArchived: boolean;
  onChange: (showArchived: boolean) => void;
  activeCount: number;
  archivedCount: number;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn("min-w-[6.75rem]", !showArchived ? selected : idle)}
      >
        <ActiveLabel count={activeCount} />
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn("min-w-[8.5rem]", showArchived ? selected : idle)}
      >
        <ArchivedLabel count={archivedCount} />
      </button>
    </div>
  );
}
