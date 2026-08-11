"use client";

import { useLayoutEffect } from "react";

const STORAGE_KEY = "eos:sidebar-collapsed";
const SHELL_ID = "app-shell";

/**
 * Apply stored sidebar collapse before paint (no inline <script> — React 19
 * warns that scripts inside components are never executed on the client).
 * Mirrors the old AppShell no-flash snippet.
 */
export function SidebarCollapseBoot() {
  useLayoutEffect(() => {
    try {
      const el = document.getElementById(SHELL_ID);
      if (!el) return;
      if (localStorage.getItem(STORAGE_KEY) === "1") {
        el.setAttribute("data-sidebar-collapsed", "");
      } else {
        el.removeAttribute("data-sidebar-collapsed");
      }
      // Notify SidebarCollapseToggle / any useSyncExternalStore listeners.
      window.dispatchEvent(new Event("hpb-sidebar-collapse-change"));
    } catch {
      /* private mode etc. */
    }
  }, []);

  return null;
}
