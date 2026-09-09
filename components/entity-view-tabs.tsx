import Link from "next/link";
import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The segmented-toggle look, exported because this app has more than one
 * segmented toggle.
 *
 * Active|Archived is not the only pair: Issues carries Short-term|Long-term on
 * both the standalone page and the L10 segment, and both were hand-rolled
 * copies of these strings. They came out 2px shorter (no `h-8` — height
 * inferred from `py-1.5`) and, more visibly, **without `tabular-nums`**, so
 * every count change re-measured the label and the pair twitched. Two toggles
 * on one screen, built from the same idea, disagreeing on both.
 *
 * `tabular-nums` is the part worth keeping deliberately: these labels all end
 * in a count that changes as the user works.
 */
export const entityToggleSelectedClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900";
export const entityToggleIdleClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm tabular-nums text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800";

const selected = entityToggleSelectedClass;
const idle = entityToggleIdleClass;

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
  params,
}: {
  basePath: string;
  showArchived: boolean;
  activeCount: number;
  archivedCount: number;
  /** Preserve an owner filter across Active / Archived. */
  owner?: string;
  /**
   * Any other query state to carry across the switch.
   *
   * The scorecard needs `period`: without it, opening Archived from the
   * Monthly tab lands you on Weekly, and the row you were looking for appears
   * to have gone missing. Empty values are dropped so the URL stays clean.
   */
  params?: Record<string, string | undefined>;
}) {
  const qs = (extra?: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (owner) sp.set("owner", owner);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v) sp.set(k, v);
    }
    for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v);
    const str = sp.toString();
    return str ? `?${str}` : "";
  };
  const activeHref = `${basePath}${qs()}`;
  const archivedHref = `${basePath}${qs({ archived: "1" })}`;

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
 * The same control, driven by local state instead of the URL.
 *
 * The meeting page cannot use the navigational version: it already owns
 * `?view=`, `?recap=1`, `?weeks=` and `?period=`, one `?archived=` would be
 * ambiguous across four segments, and — with follow-the-leader — an auto re-attach does
 * `router.replace(pathname)`, which would silently reset a viewer's Archived
 * view back to Active mid-meeting. Local state also costs nothing to read:
 * every segment already subscribes to the team's whole collection and filters
 * archived rows in memory, so the rows are on the client either way.
 *
 * Resets when the segment unmounts, by design — Active is
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
