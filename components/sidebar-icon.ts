// Icon classes for SidebarLink rows. Lives outside sidebar-link.tsx on
// purpose: that file is "use client", and a value exported from a client
// module reaches a server component (the app shell) as a client reference,
// not a string.
export const SIDEBAR_ICON = "h-4 w-4 shrink-0 group-data-[sidebar-collapsed]/shell:size-5";
