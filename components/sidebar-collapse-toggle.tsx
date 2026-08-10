"use client";

import { useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const STORAGE_KEY = "eos:sidebar-collapsed";
const SHELL_ID = "app-shell";
const COLLAPSE_CHANGE_EVENT = "hpb-sidebar-collapse-change";

function getShellEl(): HTMLElement | null {
  return document.getElementById(SHELL_ID);
}

function readCollapsed(): boolean {
  return getShellEl()?.hasAttribute("data-sidebar-collapsed") ?? false;
}

function getServerCollapsed(): boolean {
  return false;
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(COLLAPSE_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(COLLAPSE_CHANGE_EVENT, onStoreChange);
}

/** Set the collapsed state from anywhere in the shell (e.g. the collapsed
 *  team-switcher rail button expands the sidebar before opening its menu). */
export function setSidebarCollapsed(next: boolean) {
  getShellEl()?.toggleAttribute("data-sidebar-collapsed", next);
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* private mode etc. — ignore */
  }
  window.dispatchEvent(new Event(COLLAPSE_CHANGE_EVENT));
}

/**
 * Collapse/expand control for the left sidebar. Mirrors ThemeToggle's
 * pattern: the collapsed flag lives as a `data-sidebar-collapsed` attribute
 * on the shell root (set by a pre-hydration inline script in AppShell to
 * avoid a flash), and we read it via useSyncExternalStore instead of
 * mirroring it into useState+useEffect — getServerSnapshot (false) keeps
 * SSR/hydration consistent, and the dispatched event below notifies this
 * hook (and any other instance) when toggle() changes the attribute.
 */
export function SidebarCollapseToggle() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, getServerCollapsed);

  const toggle = () => setSidebarCollapsed(!collapsed);

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </button>
  );
}
