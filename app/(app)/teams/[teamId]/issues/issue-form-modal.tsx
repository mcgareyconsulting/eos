"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { addIssue, updateIssueMeta } from "./actions";
import type { IssueType } from "@/lib/issues";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalShell,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDiscardGuard,
} from "@/components/ui/modal";

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

/** Every field the form owns, in one shape, so "has this been touched?" is a
 *  comparison against the values it opened with rather than five of them. */
type IssueDraft = {
  title: string;
  ownerId: string;
  priority: string;
  type: IssueType;
  description: string;
};

/** The values the form opens with: the issue's own when editing, the page's
 *  defaults when creating. */
function draftFrom(
  issue: IssueFormValues | null,
  defaultOwnerId: string,
  defaultType: IssueType,
): IssueDraft {
  if (!issue) {
    return {
      title: "",
      ownerId: defaultOwnerId,
      priority: "",
      type: defaultType,
      description: "",
    };
  }
  return {
    title: issue.title,
    ownerId: issue.owner_id ?? "",
    priority: issue.priority ?? "",
    type: issue.type === "long" ? "long" : "short",
    description: issue.description ?? "",
  };
}

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
  const setOpen = useCallback((next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  }, [controlledOpen, onOpenChange]);

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [priority, setPriority] = useState("");
  const [type, setType] = useState<IssueType>(defaultType);
  const [description, setDescription] = useState("");
  // What the fields held when the modal opened. Kept so closing can tell an
  // untouched form (close it, no questions) from one holding typing.
  const [opened, setOpened] = useState<IssueDraft>(() =>
    draftFrom(null, defaultOwnerId, defaultType),
  );

  function hydrate(draft: IssueDraft) {
    setTitle(draft.title);
    setOwnerId(draft.ownerId);
    setPriority(draft.priority);
    setType(draft.type);
    setDescription(draft.description);
    setOpened(draft);
    setError(null);
  }

  function openCreate() {
    // Re-reads defaultType, so the new issue lands on the active Short/Long tab.
    hydrate(draftFrom(null, defaultOwnerId, defaultType));
    setOpen(true);
  }

  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(
    draftChanged({ title, ownerId, priority, type, description }, opened),
    () => setOpen(false),
  );

  // When controlled edit opens, sync fields from the issue. Render-time, so
  // the fields are populated on the same paint the modal appears.
  const editKey = open && issue ? issue.id : null;
  const [hydratedFor, setHydratedFor] = useState<string | null>(editKey);
  if (editKey !== hydratedFor) {
    setHydratedFor(editKey);
    if (editKey) hydrate(draftFrom(issue, defaultOwnerId, defaultType));
  }

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

      <ModalShell
        open={open}
        onClose={guard.requestClose}
        // Escape belongs to the discard confirm while it is up.
        dismissible={!guard.asking}
        ariaLabel={isEdit ? "Edit issue" : "Add issue"}
        size="lg"
      >
        <ModalHeader
          title={isEdit ? "Edit issue" : "Add issue"}
          onClose={guard.requestClose}
        />

        <ModalBody as="form" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Title
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue (one line)"
              required
              autoFocus
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Owner
              </span>
              <Select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Priority
              </span>
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">No priority</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Term
            </span>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as IssueType)}
            >
              <option value="short">Short-term</option>
              <option value="long">Long-term</option>
            </Select>
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

          <ModalFooter>
            <Button variant="ghost" onClick={guard.requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Adding…"
                : isEdit
                  ? "Save"
                  : "Add issue"}
            </Button>
          </ModalFooter>
        </ModalBody>
      </ModalShell>

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        message={
          isEdit
            ? "Your edits to this issue haven't been saved. Close now and they're gone."
            : "This issue hasn't been added yet. Close now and what you've typed is gone."
        }
      />
    </>
  );
}
