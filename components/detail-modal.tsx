"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Centered read-only detail dialog. The recap sheet (recap-modal.tsx) slides
// in from the right because it's a long document; this is for a single item's
// at-a-glance card, so it sits centered.
//
// size: md = compact (issues); lg = roomier (rocks with milestones + description)
const SIZE_CLASS = {
  md: "max-w-md",
  lg: "max-w-2xl",
} as const;

export function DetailModal({
  ariaLabel,
  onClose,
  children,
  size = "md",
}: {
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: keyof typeof SIZE_CLASS;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
          SIZE_CLASS[size],
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="overflow-y-auto px-6 py-6 sm:px-7 sm:py-7">{children}</div>
      </div>
    </div>
  );
}
