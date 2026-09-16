"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bold, Eye, Italic, Link2, List, ListOrdered, Pencil } from "lucide-react";
import { RichText } from "@/components/rich-text";
import {
  insertLink,
  toggleLinePrefix,
  toggleWrap,
  type Selection,
} from "@/lib/rich-text-toolbar";
import {
  applyMention,
  filterMentionCandidates,
  mentionQueryAt,
  type MentionCandidate,
  type MentionQuery,
} from "@/lib/mentions";
import { initials } from "@/lib/user-name";
import { cn } from "@/lib/utils";

// Write side of the constrained markdown subset. Deliberately a textarea with a toolbar rather than a
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
  onKeyDown: onKeyDownProp,
  placeholder,
  rows = 3,
  className,
  textareaClassName,
  id,
  autoFocus,
  mentionCandidates,
}: {
  /** Present for uncontrolled server-action forms; the textarea carries it. */
  name?: string;
  /** Present for controlled use; pair with onChange. */
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  /**
   * Runs before the built-in shortcuts, so a caller can claim a key first
   * (the comment composer posts on Cmd/Ctrl+Enter). Call preventDefault to
   * stop Cmd-B/I/K from also firing.
   */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  textareaClassName?: string;
  id?: string;
  autoFocus?: boolean;
  /**
   * People an `@` can complete to. When present, typing `@` opens a picker
   * under the textarea and choosing inserts `@Full Name` — plain text the
   * roster resolves at read time (lib/mentions.ts). Omit for no picker.
   */
  mentionCandidates?: readonly MentionCandidate[];
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

  // ---- @mention picker -----------------------------------------------------
  // Tracks the `@…` run under the caret. Recomputed from the textarea itself
  // after every change or caret move; the state only exists so the list can
  // render and so arrow keys have something to move through.
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionListId = useId();
  const mentionsOn = !!mentionCandidates && mentionCandidates.length > 0;
  const mentionMatches =
    mentionsOn && mentionQuery
      ? filterMentionCandidates(mentionCandidates!, mentionQuery.query)
      : [];
  const mentionOpen = mentionMatches.length > 0;

  const refreshMentionQuery = useCallback(() => {
    if (!mentionsOn) return;
    const area = areaRef.current;
    if (!area) return;
    // A selection is not a caret; only complete at a collapsed caret.
    const q =
      area.selectionStart === area.selectionEnd
        ? mentionQueryAt(area.value, area.selectionStart)
        : null;
    setMentionQuery((prev) =>
      prev?.start === q?.start && prev?.query === q?.query ? prev : q,
    );
    if (!q) setMentionIdx(0);
  }, [mentionsOn]);

  const pickMention = useCallback(
    (candidate: MentionCandidate) => {
      const area = areaRef.current;
      if (!area || !mentionQuery) return;
      const r = applyMention(
        text,
        mentionQuery,
        area.selectionStart,
        candidate.name,
      );
      pendingSel.current = { start: r.caret, end: r.caret };
      setMentionQuery(null);
      setMentionIdx(0);
      setText(r.text);
    },
    [mentionQuery, text, setText],
  );

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
    // The picker claims its keys first: while it is open, Enter picks rather
    // than posting, and Escape closes it rather than the dialog around it.
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx(
          (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
        );
        return;
      }
      if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionMatches[Math.min(mentionIdx, mentionMatches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMentionQuery(null);
        return;
      }
    }
    onKeyDownProp?.(e);
    if (e.defaultPrevented) return;
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
          onChange={(e) => {
            setText(e.target.value);
            refreshMentionQuery();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={refreshMentionQuery}
          onClick={refreshMentionQuery}
          onBlur={() => {
            // Let a click on a picker row land before the list goes away.
            setTimeout(() => setMentionQuery(null), 150);
          }}
          placeholder={placeholder}
          rows={rows}
          {...(mentionsOn
            ? {
                "aria-autocomplete": "list" as const,
                "aria-controls": mentionOpen ? mentionListId : undefined,
                "aria-expanded": mentionOpen,
              }
            : {})}
          className={cn(
            "block w-full resize-y border-0 bg-transparent px-2.5 py-1.5 text-sm focus:outline-none focus:ring-0",
            textareaClassName,
          )}
        />
      )}

      {/* In flow (not floated) so the editor's overflow-hidden box can never
          clip it, and so a dialog's scroll container keeps it reachable. It
          sits between the textarea and the toolbar in the DOM, which the
          column reverse renders directly under the text. */}
      {mentionOpen && (
        <ul
          id={mentionListId}
          role="listbox"
          aria-label="Mention someone"
          className="max-h-48 overflow-y-auto border-t border-zinc-200 bg-white py-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {mentionMatches.map((c, i) => {
            const active = i === Math.min(mentionIdx, mentionMatches.length - 1);
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={active}
                // mousedown, not click: the textarea's blur fires first on
                // click and would close the list before the choice landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(c);
                }}
                onMouseEnter={() => setMentionIdx(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm",
                  active
                    ? "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold"
                    : "text-zinc-800 dark:text-zinc-200",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[9px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {initials(c.name) || "?"}
                </span>
                <span className="min-w-0 truncate">{c.name}</span>
              </li>
            );
          })}
        </ul>
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
