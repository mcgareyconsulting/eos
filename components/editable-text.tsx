"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onSave: (next: string) => Promise<unknown>;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
};

export function EditableText({
  value,
  onSave,
  className,
  placeholder,
  multiline = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, start] = useTransition();

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    start(async () => {
      try {
        await onSave(trimmed);
      } catch {
        setDraft(value);
      } finally {
        setEditing(false);
      }
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={cn(
          "text-left w-full rounded-sm hover:bg-zinc-100 px-1 -mx-1",
          !value && "text-zinc-400 italic",
          className,
        )}
        title="Click to edit"
      >
        {value || placeholder || "—"}
      </button>
    );
  }

  const sharedProps = {
    autoFocus: true,
    value: draft,
    disabled: pending,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      } else if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      }
    },
    className: cn(
      "block w-full rounded-sm border border-zinc-300 px-1 -mx-1 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900",
      className,
    ),
  };

  return multiline ? <textarea rows={2} {...sharedProps} /> : <input {...sharedProps} />;
}
