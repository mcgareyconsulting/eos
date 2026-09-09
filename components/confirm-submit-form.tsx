"use client";

import { useRef, useState, type ReactNode } from "react";
import { ModalBody, ModalFooter, ModalHeader, ModalShell } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Drop-in replacement for `<form action={...}>` on destructive actions
 * (remove measurable, delete rock, delete issue, ...). Blocks the submit
 * behind a confirmation dialog so nothing destructive is one click away.
 *
 * Works from both server and client components: this file is the only
 * "use client" boundary, so a server component can pass its bound server
 * action straight through as `action`.
 *
 * **The dialog is ours, not the browser's.** It used to be `window.confirm`,
 * which meant every destructive action in the app was explained in a grey OS
 * box with the origin printed above it, no styling, no dark mode, and only
 * "OK" for a button — so the one moment that most needs to say *what* is about
 * to happen said it in the least legible surface in the product. It also could
 * not distinguish "Remove from this scorecard" from "Delete permanently",
 * because OK is OK. The props are unchanged, so every existing caller gets
 * this for free.
 */
export function ConfirmSubmitForm({
  action,
  confirmMessage,
  title = "Are you sure?",
  confirmLabel = "Confirm",
  destructive = true,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** The dialog's body. Say what happens and what does not. */
  confirmMessage: string;
  /** Dialog heading. Name the action rather than asking a generic question. */
  title?: string;
  /**
   * The accept button's label. **Name the act**: a button reading "Remove
   * measurable" tells you what you are agreeing to at the moment you agree,
   * which "OK" never did.
   */
  confirmLabel?: string;
  /**
   * Red accept button. On by default because this component exists for
   * destructive actions — pass `false` for a confirmation that only asks the
   * user to pause, like removing a row from a view.
   */
  destructive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Set for exactly one submit, so the accept button's `requestSubmit()` is
  // not caught by the same guard that opened the dialog.
  const confirmed = useRef(false);

  return (
    <>
      <form
        ref={formRef}
        action={action}
        className={className}
        onSubmit={(e) => {
          if (confirmed.current) {
            confirmed.current = false;
            return;
          }
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </form>

      {/* Portalled: these forms sit inside table rows and expand panels whose
          overflow and stacking contexts would otherwise clip the dialog. */}
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={title}
        size="md"
        portal
      >
        <ModalHeader title={title} onClose={() => setOpen(false)} />
        <ModalBody>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {confirmMessage}
          </p>
        </ModalBody>
        <ModalFooter className="px-4 pb-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            autoFocus
            className={cn(
              destructive &&
                "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700",
            )}
            onClick={() => {
              setOpen(false);
              confirmed.current = true;
              formRef.current?.requestSubmit();
            }}
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalShell>
    </>
  );
}
