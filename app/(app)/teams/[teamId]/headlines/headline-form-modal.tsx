"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { addHeadline, updateHeadline } from "./actions";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalShell,
  ModalHeader,
  useDiscardGuard,
} from "@/components/ui/modal";

const KIND_OPTIONS = [
  { value: "customer", label: "Customer" },
  { value: "employee", label: "Employee" },
  { value: "cascading", label: "Cascading" },
  { value: "general", label: "General / FYI" },
] as const;

type Kind = (typeof KIND_OPTIONS)[number]["value"];

export type HeadlineEditValues = {
  id: string;
  title: string;
  body: string | null;
  kind: Kind;
};

/** Every field the form owns, in one shape — see draftChanged. */
type HeadlineDraft = { title: string; kind: Kind; body: string };

/** The values the form opens with: the headline's own when editing, blanks
 *  when creating. */
function draftFrom(headline: HeadlineEditValues | null): HeadlineDraft {
  if (!headline) return { title: "", kind: "customer", body: "" };
  return {
    title: headline.title,
    kind: headline.kind,
    body: headline.body ?? "",
  };
}

type HeadlineFormModalProps =
  | {
      mode: "create";
      teamId: string;
      buttonLabel?: string;
      /** Smaller trigger for the L10 toolbar row. */
      compact?: boolean;
    }
  | {
      mode: "edit";
      teamId: string;
      headline: HeadlineEditValues;
    };

/**
 * Add/edit headline modal. Same shell for both; each carries its own trigger
 * button and open state, so create and edit never share a mounted instance.
 */
export function HeadlineFormModal(props: HeadlineFormModalProps) {
  const isEdit = props.mode === "edit";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(isEdit ? props.headline.title : "");
  const [kind, setKind] = useState<Kind>(
    isEdit ? props.headline.kind : "customer",
  );
  const [body, setBody] = useState(isEdit ? (props.headline.body ?? "") : "");
  // What the fields held when the modal opened. On edit that is the headline
  // itself, so a modal opened and closed without a keystroke asks nothing.
  const [opened, setOpened] = useState<HeadlineDraft>(() =>
    draftFrom(isEdit ? props.headline : null),
  );

  function hydrate(draft: HeadlineDraft) {
    setTitle(draft.title);
    setKind(draft.kind);
    setBody(draft.body);
    setOpened(draft);
    setError(null);
  }

  function openModal() {
    hydrate(draftFrom(props.mode === "edit" ? props.headline : null));
    setOpen(true);
  }

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(
    draftChanged({ title, kind, body }, opened),
    () => setOpen(false),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", trimmed);
    fd.set("kind", kind);
    fd.set("body", body);

    start(async () => {
      try {
        setError(null);
        if (isEdit) {
          await updateHeadline(props.teamId, props.headline.id, fd);
        } else {
          await addHeadline(props.teamId, fd);
          // Edit relies on the server action's revalidatePath alone; create
          // additionally refreshes so the new row appears without a nav.
          router.refresh();
        }
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      {isEdit ? (
        <button
          type="button"
          onClick={openModal}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Edit headline"
          title="Edit"
        >
          <Pencil className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className={
            props.compact
              ? "inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
              : entityAddButtonClass
          }
        >
          <Plus className={props.compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {props.buttonLabel ?? "Add headline"}
        </button>
      )}

      {/* Portalled to <body> on edit: the trigger lives inside a row action
          cluster that fades with `opacity-0 group-hover:opacity-100`, and
          opacity applies to the whole subtree — a `fixed` child is not
          exempt. Rendered in place, an open dialog went invisible the
          moment the pointer left the row. The portal takes it out from
          under that ancestor entirely. Create's trigger sits in a page
          header/toolbar with no such ancestor, so it doesn't need one. */}
      <ModalShell
        open={open}
        onClose={guard.requestClose}
        // Escape belongs to the discard confirm while it is up.
        dismissible={!guard.asking}
        ariaLabel={isEdit ? "Edit headline" : "Add headline"}
        size="4xl"
        portal={isEdit}
      >
        <ModalHeader
          title={isEdit ? "Edit headline" : "Add headline"}
          onClose={guard.requestClose}
        />

        {/* Fields scroll; the footer stays pinned so Save/Add is always
            reachable no matter how much the author writes in Detail. */}
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
                onChange={(e) => setKind(e.target.value as Kind)}
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
            <Button variant="ghost" onClick={guard.requestClose}>
              Cancel
            </Button>
            {isEdit ? (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            ) : (
              <button
                type="submit"
                disabled={pending || !title.trim()}
                className="rounded-md bg-hpb-blue px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Adding…" : "Add headline"}
              </button>
            )}
          </div>
        </form>
      </ModalShell>

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        message={
          isEdit
            ? "Your edits to this headline haven't been saved. Close now and they're gone."
            : "This headline hasn't been added yet. Close now and what you've typed is gone."
        }
      />
    </>
  );
}
