"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { addIssue, updateIssueMeta } from "./actions";
import type { IssueType } from "@/lib/issues";
import { RichTextEditor } from "@/components/rich-text-editor";

type Member = { user_id: string; full_name: string };

export type IssueFormValues = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: string | null;
  type: IssueType | null | undefined;
};

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

/**
 * Centered modal for create + edit. Same shell as Add to-do.
 * Create defaults `type` from the active Short/Long tab.
 */
export function IssueFormModal({
  teamId,
  members,
  defaultOwnerId,
  defaultType = "short",
  issue = null,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  buttonLabel = "Add issue",
}: {
  teamId: string;
  members: Member[];
  defaultOwnerId: string;
  /** Prefill when creating (from active Short/Long tab). */
  defaultType?: IssueType;
  /** When set, modal is edit mode for this issue. */
  issue?: IssueFormValues | null;
  /** Controlled open (edit). Uncontrolled when only the trigger is used. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const isEdit = !!issue;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  };

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [priority, setPriority] = useState("");
  const [type, setType] = useState<IssueType>(defaultType);
  const [description, setDescription] = useState("");

  function hydrateFromProps() {
    if (issue) {
      setTitle(issue.title);
      setOwnerId(issue.owner_id ?? "");
      setPriority(issue.priority ?? "");
      setType(issue.type === "long" ? "long" : "short");
      setDescription(issue.description ?? "");
    } else {
      setTitle("");
      setOwnerId(defaultOwnerId);
      setPriority("");
      setType(defaultType);
      setDescription("");
    }
    setError(null);
  }

  function openCreate() {
    hydrateFromProps();
    // Create path always re-reads defaultType from the active tab.
    setTitle("");
    setOwnerId(defaultOwnerId);
    setPriority("");
    setType(defaultType);
    setDescription("");
    setError(null);
    setOpen(true);
  }

  // When controlled edit opens, sync fields from the issue.
  useEffect(() => {
    if (!open) return;
    if (issue) hydrateFromProps();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-hydrate when open/issue id flips
  }, [open, issue?.id]);

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
    fd.set("title", title);
    fd.set("owner_id", ownerId);
    fd.set("priority", priority);
    fd.set("type", type);
    fd.set("description", description);

    start(async () => {
      try {
        setError(null);
        if (isEdit && issue) {
          await updateIssueMeta(teamId, issue.id, fd);
        } else {
          await addIssue(teamId, fd);
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      {showTrigger && !isEdit && (
        <button
          type="button"
          onClick={openCreate}
          className={entityAddButtonClass}
        >
          <Plus className="h-4 w-4" />
          {buttonLabel}
        </button>
      )}

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
            aria-label={isEdit ? "Edit issue" : "Add issue"}
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-base font-semibold tracking-tight">
                {isEdit ? "Edit issue" : "Add issue"}
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

            <form
              onSubmit={submit}
              className="flex flex-col gap-3 overflow-y-auto px-5 py-4"
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Title
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Issue (one line)"
                  required
                  autoFocus
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Owner
                  </span>
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Priority
                  </span>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="">No priority</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Term
                </span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as IssueType)}
                  className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="short">Short-term</option>
                  <option value="long">Long-term</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Description{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder="Decision notes, context, links…"
                  rows={8}
                  textareaClassName="min-h-[10rem] leading-relaxed"
                  className="dark:bg-zinc-950"
                />
              </label>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="mt-1 flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {pending
                    ? isEdit
                      ? "Saving…"
                      : "Adding…"
                    : isEdit
                      ? "Save"
                      : "Add issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
