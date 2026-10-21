"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "@/components/ui/modal";

/**
 * Wide two-column detail dialog: the item on the left, a rail on the right
 * (the item's ActivityFeed). The R3 / T4 / I1 / H1 shell.
 *
 * - `5xl` panel (Rock edit's width), capped at 90vh like every centered
 *   dialog. From `md` up the two columns sit side by side — details take
 *   the rest, the rail is 360px — and each scrolls on its own, so a long
 *   thread never pushes the details out of reach or the other way round.
 *   Below `md` the rail stacks under the details and the panel scrolls as
 *   one.
 * - Portalled to <body> by default, so it paints above whatever it opened
 *   from — the live L10's rail and its fixed "Catch up" pill (z-50, in the
 *   page) included — and outside any ancestor's overflow or opacity.
 * - Escape closes it only while it is the topmost dialog, and not when
 *   something inside claimed the key (the comment composer does, to fold
 *   itself away). A confirm or edit dialog opened on top answers Escape
 *   alone; the detail underneath stays open.
 */
export function DetailShell({
  ariaLabel,
  onClose,
  aside,
  asideLabel = "Activity",
  banner,
  dismissible = true,
  portal = true,
  closeButton = true,
  className,
  bodyClassName,
  asideClassName,
  children,
}: {
  ariaLabel: string;
  onClose: () => void;
  /** Right rail — normally `<ActivityFeed … />`. */
  aside: ReactNode;
  /** Landmark name for the rail. */
  asideLabel?: string;
  /** Full-width strip above both columns (e.g. a rock status banner). */
  banner?: ReactNode;
  /**
   * Escape and backdrop stop closing while this is false — set it while a
   * discard guard or another dialog that should own Escape is up (see
   * `useDiscardGuard`).
   */
  dismissible?: boolean;
  /** Render in place instead of into <body>. Rarely what you want. */
  portal?: boolean;
  /**
   * The × over the rail's corner. Off when `banner` is a full header that
   * carries its own close control (the feedback tracker's modal).
   */
  closeButton?: boolean;
  /** Extra classes on the panel. */
  className?: string;
  /** Extra classes on the left (details) column. */
  bodyClassName?: string;
  /**
   * Extra classes on the rail — e.g. `flex flex-col p-0 md:overflow-hidden`
   * for a rail that scrolls its own list under a pinned composer.
   */
  asideClassName?: string;
  /** Left column — the item's details. */
  children: ReactNode;
}) {
  return (
    <ModalShell
      open
      onClose={onClose}
      ariaLabel={ariaLabel}
      size="5xl"
      portal={portal}
      dismissible={dismissible}
      escape="topmost"
      banner={banner}
      className={className}
    >
      {/* Not ModalBody: the panel is a capped-height flex column. Below md
          this grid is the one scroll region; from md up it stops scrolling
          and hands that to each column. */}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:min-h-[min(28rem,80vh)] md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
        {closeButton && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div
          className={cn(
            // pr-12 below md keeps the title clear of the close button,
            // which sits over the rail from md up.
            "min-h-0 py-6 pl-6 pr-12 sm:pl-7 md:overflow-y-auto md:pr-7",
            bodyClassName,
          )}
        >
          {children}
        </div>
        <aside
          aria-label={asideLabel}
          className={cn(
            "min-h-0 border-t border-zinc-200 bg-zinc-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/30 md:overflow-y-auto md:border-l md:border-t-0",
            asideClassName,
          )}
        >
          {aside}
        </aside>
      </div>
    </ModalShell>
  );
}
