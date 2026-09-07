"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell, type ModalSize } from "@/components/ui/modal";

// Centered read-only detail dialog for a single item's at-a-glance card.
//
// size: md = compact (issues); lg = roomier (rocks with milestones + description)
// banner: optional full-width strip above the padded body (rock status banner).
// When banner is set, the close button sits in the body (top-right) instead of
// over the banner.
const SHELL_SIZE: Record<"md" | "lg", ModalSize> = {
  md: "md",
  lg: "2xl",
};

export function DetailModal({
  ariaLabel,
  onClose,
  children,
  size = "md",
  banner,
}: {
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg";
  banner?: React.ReactNode;
}) {
  const closeBtn = (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-3 top-3 z-10 rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      aria-label="Close"
    >
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <ModalShell
      open
      onClose={onClose}
      ariaLabel={ariaLabel}
      size={SHELL_SIZE[size]}
    >
      {banner}
      {!banner && closeBtn}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-y-auto",
          banner
            ? "px-6 py-5 sm:px-7 sm:py-6"
            : "px-6 py-6 sm:px-7 sm:py-7",
        )}
      >
        {banner ? closeBtn : null}
        {children}
      </div>
    </ModalShell>
  );
}
