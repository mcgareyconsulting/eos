"use client";

import type { ReactNode } from "react";

/**
 * Drop-in replacement for `<form action={...}>` on destructive actions
 * (delete rock, delete issue, ...). Blocks the submit with a native confirm
 * dialog so nothing is one click away — see docs/ROADMAP.md Pass 18 item 8.
 *
 * Works from both server and client components: this file is the only
 * "use client" boundary, so a server component can pass its bound server
 * action straight through as `action`.
 */
export function ConfirmSubmitForm({
  action,
  confirmMessage,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Shown via window.confirm(); submit proceeds only if the user accepts. */
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
