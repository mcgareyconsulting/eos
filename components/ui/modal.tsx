"use client";

import { useCallback, useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "@/components/ui/button";

/**
 * Registers a single window "keydown" listener while `enabled`, calling
 * `onClose` on Escape. Shared by every dialog shell below and by the
 * popovers/inline editors that dismiss on Escape without a full dialog shell.
 */
export function useDismissOnEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onClose]);
}

// Centered-panel base class per size. Each string is verbatim from the call
// site(s) that used it before this shell existed — widths and heights are
// never invented, only reused.
const SIZE_CLASS = {
  md: "relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
  lg: "relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
  "2xl": "relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
  "3xl": "relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
  "4xl": "relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
  "5xl": "relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900",
} as const;

export type ModalSize = keyof typeof SIZE_CLASS;

export type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  /** Panel width (and, for the 92vh sites, height) — see SIZE_CLASS above. Defaults to "lg", the most common size. */
  size?: ModalSize;
  /** Backdrop click dismisses. Every existing dialog did this, so it defaults true. */
  closeOnBackdrop?: boolean;
  /**
   * Escape and backdrop stop dismissing while this is false. Set it while a
   * nested dialog sits on top of this one (see `useDiscardGuard`): both shells
   * listen for Escape on the window, so without this one keypress would be
   * answered by the confirm *and* by the form underneath it.
   */
  dismissible?: boolean;
  /** Render into document.body instead of in place. Only pass this where the
   *  dialog already portalled — an ancestor's opacity/overflow otherwise hides
   *  it (see headline-edit-modal, manage-groups). */
  portal?: boolean;
  /** Full-width strip above the padded body (e.g. a rock status banner). */
  banner?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Backdrop + centered dialog panel shared by every centered modal in the app. */
export function ModalShell({
  open,
  onClose,
  ariaLabel,
  size = "lg",
  closeOnBackdrop = true,
  dismissible = true,
  portal = false,
  banner,
  className,
  children,
}: ModalShellProps) {
  useDismissOnEscape(onClose, open && dismissible);

  if (!open) return null;

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={closeOnBackdrop && dismissible ? onClose : undefined}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(SIZE_CLASS[size], className)}
      >
        {banner}
        {children}
      </div>
    </div>
  );

  return portal ? createPortal(dialog, document.body) : dialog;
}

/** The ×8 header row: title on the left, close control (or a custom slot) on the right. */
export function ModalHeader({
  title,
  onClose,
  right,
  as: Comp = "div",
}: {
  title: ReactNode;
  /** "header" where the site used a landmark element (the meeting recap). */
  as?: "div" | "header";
  /** Renders the standard close IconButton on the right when set. */
  onClose?: () => void;
  /** Overrides the default close button — for a header with something else there. */
  right?: ReactNode;
}) {
  return (
    <Comp className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
      {typeof title === "string" ? (
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      ) : (
        title
      )}
      {right ??
        (onClose ? (
          <IconButton onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </IconButton>
        ) : null)}
    </Comp>
  );
}

export type ModalBodyProps = HTMLAttributes<HTMLElement> & {
  /** "form" for the sites where this is the <form> itself (onSubmit lives on it). */
  as?: "div" | "form";
};

/** Scrollable field column shared by the four single-scroll-region forms
 *  (issue, add measurable, edit measurable, add to-do). */
export function ModalBody({ className, as = "div", ...props }: ModalBodyProps) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        "flex flex-col gap-3 overflow-y-auto px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export type ModalFooterProps = HTMLAttributes<HTMLDivElement>;

/** Footer row shared by the same four forms as ModalBody — sits inside the
 *  scrolling body, not pinned. */
export function ModalFooter({ className, ...props }: ModalFooterProps) {
  return (
    <div
      className={cn(
        "mt-1 flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Field-by-field compare of what the form holds now against what it opened
 * with. Deliberately shallow: a draft is a flat record of form values, and
 * anything that isn't (a list of milestone rows, a set of ids) is folded into
 * a string by the form before it gets here, so there is one comparison rule
 * rather than one per field type.
 *
 * Comparing against the *opened* values rather than against empty is what
 * makes this work on edit forms as well as create ones. An edit modal opens
 * full of data and is not dirty; type a word and delete it again and it is
 * not dirty either.
 */
export function draftChanged<T extends object>(current: T, opened: T): boolean {
  return (Object.keys(current) as (keyof T)[]).some(
    (k) => current[k] !== opened[k],
  );
}

/**
 * Confirm-before-discard for a dialog holding unsaved edits.
 *
 * The complaint this answers: a click that lands one pixel outside the Add
 * issue box throws away everything typed into it, with no warning and no way
 * back. Autosaving the draft was the other candidate fix, and it is worse
 * here — a half-typed issue that saves itself is a half-typed issue on the
 * list, visible to the team, votable, and needing cleanup. The work only has
 * to survive the accident, not become a record.
 *
 * So closing is not blocked, only interrupted, and only when there is
 * something to lose: `dirty` false closes straight through, so the common
 * case (open it, change your mind, click out) is unchanged.
 *
 * Route *every* way out of the dialog through `requestClose` — backdrop,
 * Escape, the header ×, and Cancel. A Cancel that discards silently while the
 * × asks first is the kind of inconsistency people learn the hard way.
 */
export function useDiscardGuard(dirty: boolean, close: () => void) {
  const [asking, setAsking] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty) setAsking(true);
    else close();
  }, [dirty, close]);

  const discard = useCallback(() => {
    setAsking(false);
    close();
  }, [close]);

  const keepEditing = useCallback(() => setAsking(false), []);

  return { asking, requestClose, discard, keepEditing };
}

/**
 * The dialog `useDiscardGuard` puts in front of the close. Render it as a
 * sibling of the form's own `ModalShell` and pass the guard through:
 *
 *     <ModalShell open={open} onClose={guard.requestClose}
 *                 dismissible={!guard.asking} …>
 *     <DiscardChangesDialog open={guard.asking}
 *                           onKeepEditing={guard.keepEditing}
 *                           onDiscard={guard.discard} />
 *
 * **Keep editing is the primary and holds focus**, and Escape answers it, so
 * every reflex that lands on this dialog by accident — Enter, Escape, a click
 * on the backdrop — keeps the draft. Discarding is the deliberate one.
 */
export function DiscardChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
  title = "Discard your changes?",
  message = "You have unsaved changes here. Close now and they're gone.",
  discardLabel = "Discard changes",
}: {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  title?: string;
  /** Say what is lost, in the words of the thing being edited. */
  message?: string;
  discardLabel?: string;
}) {
  return (
    // Portalled so it paints above the dialog it interrupts, whatever stacking
    // context that one sits in.
    <ModalShell
      open={open}
      onClose={onKeepEditing}
      ariaLabel={title}
      size="md"
      portal
    >
      <ModalHeader title={title} onClose={onKeepEditing} />
      <ModalBody>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
      </ModalBody>
      <ModalFooter className="px-4 pb-4">
        <Button
          variant="ghost"
          onClick={onDiscard}
          className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
        >
          {discardLabel}
        </Button>
        <Button autoFocus onClick={onKeepEditing}>
          Keep editing
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
