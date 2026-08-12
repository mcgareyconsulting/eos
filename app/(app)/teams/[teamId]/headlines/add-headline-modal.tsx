"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { addHeadline } from "./actions";
import { RichTextEditor } from "@/components/rich-text-editor";

const KIND_OPTIONS = [
  { value: "customer", label: "Customer" },
  { value: "employee", label: "Employee" },
  { value: "cascading", label: "Cascading" },
  { value: "general", label: "General / FYI" },
] as const;

type Kind = (typeof KIND_OPTIONS)[number]["value"];

export function AddHeadlineModal({
  teamId,
  buttonLabel = "Add headline",
}: {
  teamId: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("customer");
  const [body, setBody] = useState("");

  function resetForOpen() {
    setTitle("");
    setKind("customer");
    setBody("");
    setError(null);
  }

  function openModal() {
    resetForOpen();
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
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("kind", kind);
    fd.set("body", body);

    start(async () => {
      try {
        setError(null);
        await addHeadline(teamId, fd);
        setOpen(false);
        router.refresh();
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
        className={entityAddButtonClass}
      >
        <Plus className="h-4 w-4" />
        {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add headline"
            className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-base font-semibold tracking-tight">
                Add headline
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Headline
                  </span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Headline (one line)"
                    required
                    autoFocus
                    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Category
                  </span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Kind)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {KIND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
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
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || !title.trim()}
                  className="rounded-md bg-hpb-blue px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
                >
                  {pending ? "Adding…" : "Add headline"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
