"use client";

import { Printer } from "lucide-react";
import { entityHeaderControlBase } from "@/components/entity-page-header";

/** Opens the browser's print dialog (Save as PDF lives there). Screen-only. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      // Light-only chrome: the print sheet ignores the app theme.
      className={`${entityHeaderControlBase} border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 focus-visible:ring-hpb-blue/40 print:hidden`}
    >
      <Printer className="h-3.5 w-3.5" aria-hidden />
      Print / Save as PDF
    </button>
  );
}
