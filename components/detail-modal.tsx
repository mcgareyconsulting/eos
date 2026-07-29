"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

// Centered read-only detail dialog. The recap sheet (recap-modal.tsx) slides
// in from the right because it's a long document; this is for a single item's
// at-a-glance card, so it sits centered and stays compact.
export function DetailModal({
  ariaLabel,
  onClose,
  children,
}: {
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
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
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
