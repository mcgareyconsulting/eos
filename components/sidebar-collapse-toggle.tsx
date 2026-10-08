"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";

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

/** Set the collapsed state from anywhere in the shell. */
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
 * on the shell root (applied by SidebarCollapseBoot via useLayoutEffect from
 * localStorage), and we read it via useSyncExternalStore instead of
 * mirroring it into useState+useEffect — getServerSnapshot (false) keeps
 * SSR/hydration consistent, and the dispatched event below notifies this
 * hook (and any other instance) when toggle() changes the attribute.
 */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readCollapsed, getServerCollapsed);
}

/**
 * The sidebar's brand logo doubles as its collapse toggle: collapsed shows
 * the circle mark, expanded shows the HPB Pulse lockup (light/dark variants
 * swap on the theme class). Which logo shows is CSS-driven off the shell's
 * data attribute, so the first paint is right before hydration.
 */
export function SidebarCollapseToggle() {
  const collapsed = useSidebarCollapsed();

  const toggle = () => setSidebarCollapsed(!collapsed);

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center justify-center rounded-md p-1 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-hpb-blue dark:hover:bg-zinc-800 dark:focus-visible:outline-hpb-gold"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      <Image
        src="/brand/hpb-mark.svg"
        alt=""
        width={36}
        height={36}
        unoptimized
        className="hidden h-9 w-9 group-data-[sidebar-collapsed]/shell:block"
      />
      <span className="block w-full group-data-[sidebar-collapsed]/shell:hidden">
        <Image
          src="/brand/hpb-pulse-lockup.svg"
          alt=""
          width={200}
          height={46}
          unoptimized
          className="block h-auto w-full dark:hidden"
        />
        <Image
          src="/brand/hpb-pulse-lockup-dark.svg"
          alt=""
          width={200}
          height={46}
          unoptimized
          className="hidden h-auto w-full dark:block"
        />
      </span>
    </button>
  );
}
