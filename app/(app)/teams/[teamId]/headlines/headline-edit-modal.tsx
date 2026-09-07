"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { updateHeadline } from "./actions";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export type HeadlineEditValues = {
  id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading" | "general";
};

const KIND_OPTIONS: { value: HeadlineEditValues["kind"]; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "employee", label: "Employee" },
  { value: "cascading", label: "Cascading" },
  { value: "general", label: "General / FYI" },
];

/**
 * Pencil trigger + small modal for editing a headline's title, detail, and
 * category. Same shell as the issue edit modal, trimmed to headline fields.
 * Shared between the Headlines tab and the L10 meeting segment.
 */
export function HeadlineEditButton({
  teamId,
  headline,
}: {
  teamId: string;
  headline: HeadlineEditValues;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(headline.title);
  const [body, setBody] = useState(headline.body ?? "");
  const [kind, setKind] = useState<HeadlineEditValues["kind"]>(headline.kind);

  function openModal() {
    setTitle(headline.title);
    setBody(headline.body ?? "");
    setKind(headline.kind);
    setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", trimmed);
    fd.set("body", body);
    fd.set("kind", kind);
    start(async () => {
      try {
        setError(null);
        await updateHeadline(teamId, headline.id, fd);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label="Edit headline"
        title="Edit"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {/* Portalled to <body>: the trigger lives inside a row action
          cluster that fades with `opacity-0 group-hover:opacity-100`,
          and opacity applies to the whole subtree — a `fixed` child is
          not exempt. Rendered in place, an open dialog went invisible
          the moment the pointer left the row (client-reported 8/19).
          The portal takes it out from under that ancestor entirely. */}
      {/* No SSR guard needed: `open` starts false and only a click sets it,
          so this branch is never reached during the server render. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Edit headline"
              className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <h2 className="text-base font-semibold tracking-tight">
                  Edit headline
                </h2>
                <IconButton onClick={() => setOpen(false)} aria-label="Close">
                  <X className="h-4 w-4" />
                </IconButton>
              </div>

              {/* Fields scroll; the footer stays pinned so Save is always reachable
                  no matter how much the author writes in Detail. */}
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Headline
                  </span>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Headline (one line)"
                    required
                    autoFocus
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Category
                  </span>
                  <Select
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as HeadlineEditValues["kind"])
                    }
                  >
                    {KIND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Detail{" "}
                    <span className="font-normal text-zinc-400">(optional)</span>
                  </span>
                  <RichTextEditor
                    value={body}
                    onChange={setBody}
                    rows={16}
                    placeholder="Detail (optional)"
                    textareaClassName="leading-relaxed"
                    className="dark:bg-zinc-950"
                  />
                </label>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
