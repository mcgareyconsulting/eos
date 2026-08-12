"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Eye, Italic, Link2, List, ListOrdered, Pencil } from "lucide-react";
import { RichText } from "@/components/rich-text";
import {
  insertLink,
  toggleLinePrefix,
  toggleWrap,
  type Selection,
} from "@/lib/rich-text-toolbar";
import { cn } from "@/lib/utils";

// Write side of P3-2. Deliberately a textarea with a toolbar rather than a
// WYSIWYG surface: the stored value stays the same plain string it always was,
// so there is no HTML to sanitize, no second format to read, and no migration.
// The toolbar inserts the markers lib/rich-text.ts understands; Preview shows
// the exact renderer the read surfaces use.
//
// Works controlled (modals holding their own state, `value` + `onChange`) and
// uncontrolled (server-action forms passing only `name`), because both shapes
// already exist in the app.

const TOOLBAR_BUTTON =
  "inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100";

export function RichTextEditor({
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  rows = 3,
  className,
  textareaClassName,
  id,
  autoFocus,
}: {
  /** Present for uncontrolled server-action forms; the textarea carries it. */
  name?: string;
  /** Present for controlled use; pair with onChange. */
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  textareaClassName?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const text = controlled ? value : internal;

  const [preview, setPreview] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<Selection | null>(null);

  const setText = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  // A server-action form clears its uncontrolled fields when React calls
  // formElement.reset() after the action resolves — that fires a "reset"
  // event. Internal state has to follow it, or the box would keep its text
  // while every sibling input clears.
  useEffect(() => {
    if (controlled) return;
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setInternal(defaultValue ?? "");
      setPreview(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled, defaultValue]);

  // Restore the caret after a toolbar edit — React re-renders from state, so
  // the selection has to be reapplied once the new value is in the DOM.
  useEffect(() => {
    const sel = pendingSel.current;
    const area = areaRef.current;
    if (!sel || !area) return;
    pendingSel.current = null;
    area.focus();
    area.setSelectionRange(sel.start, sel.end);
  }, [text]);

  const apply = useCallback(
    (fn: (t: string, s: Selection) => { text: string; sel: Selection }) => {
      const area = areaRef.current;
      if (!area) return;
      const result = fn(text, {
        start: area.selectionStart,
        end: area.selectionEnd,
      });
      // Clicking a toolbar button moved focus to that button. Take it back
      // before anything else: if the transform is a no-op the state never
      // changes, so no re-render happens and the effect below never runs —
      // focus would stay on the button and the user's next keystrokes would
      // go nowhere.
      area.focus();
      if (result.text === text) {
        area.setSelectionRange(result.sel.start, result.sel.end);
        return;
      }
      pendingSel.current = result.sel;
      setText(result.text);
    },
    [text, setText],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      apply((t, s) => toggleWrap(t, s, "**", "bold text"));
    } else if (key === "i") {
      e.preventDefault();
      apply((t, s) => toggleWrap(t, s, "_", "italic text"));
    } else if (key === "k") {
      e.preventDefault();
      apply(insertLink);
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex flex-col-reverse overflow-hidden rounded-md border border-zinc-300 bg-white focus-within:ring-2 focus-within:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900",
        className,
      )}
    >
      {/* The editing surface comes FIRST in the DOM; the wrapper reverses it
          visually (flex-col-reverse) so the toolbar still sits on top. Every
          call site wraps this in a <label> (three directly, two via their
          local Field), and a <label> binds to its first labelable descendant
          — buttons included. With the toolbar first in the DOM, clicking the
          "Description" label would fire Bold and insert "**bold text**"
          instead of focusing the box. Accepted trade: Tab reaches the toolbar
          after the textarea rather than before it. */}
      {preview ? (
        <div
          className="px-2.5 py-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
          style={{ minHeight: `${rows * 1.5 + 0.75}rem` }}
        >
          {hasText ? (
            <RichText value={text} />
          ) : (
            <span className="text-sm italic text-zinc-400">Nothing to preview.</span>
          )}
        </div>
      ) : (
        <textarea
          ref={areaRef}
          id={id}
          name={name}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={rows}
          className={cn(
            "block w-full resize-y border-0 bg-transparent px-2.5 py-1.5 text-sm focus:outline-none focus:ring-0",
            textareaClassName,
          )}
        />
      )}

      {/* Uncontrolled forms post `name` from the textarea, which unmounts in
          preview mode — mirror the value so submitting from preview still
          sends it. */}
      {preview && name && <input type="hidden" name={name} value={text} />}

      <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1 py-1 dark:border-zinc-800 dark:bg-zinc-800/50">
        <button
          type="button"
          onClick={() => apply((t, s) => toggleWrap(t, s, "**", "bold text"))}
          disabled={preview}
          className={TOOLBAR_BUTTON}
          title="Bold (⌘B)"
          aria-label="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => apply((t, s) => toggleWrap(t, s, "_", "italic text"))}
          disabled={preview}
          className={TOOLBAR_BUTTON}
          title="Italic (⌘I)"
          aria-label="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button
          type="button"
          onClick={() => apply((t, s) => toggleLinePrefix(t, s, "bullet"))}
          disabled={preview}
          className={TOOLBAR_BUTTON}
          title="Bulleted list"
          aria-label="Bulleted list"
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => apply((t, s) => toggleLinePrefix(t, s, "ordered"))}
          disabled={preview}
          className={TOOLBAR_BUTTON}
          title="Numbered list"
          aria-label="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button
          type="button"
          onClick={() => apply(insertLink)}
          disabled={preview}
          className={TOOLBAR_BUTTON}
          title="Link (⌘K)"
          aria-label="Insert link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          disabled={!hasText && !preview}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100",
            preview && "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
          )}
          title={preview ? "Back to editing" : "Preview formatting"}
        >
          {preview ? (
            <>
              <Pencil className="h-3 w-3" /> Edit
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" /> Preview
            </>
          )}
        </button>
      </div>
    </div>
  );
}
