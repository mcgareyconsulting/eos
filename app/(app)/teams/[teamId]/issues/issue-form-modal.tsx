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
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";

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

  // When controlled edit opens, sync fields from the issue. Render-time, so
  // the fields are populated on the same paint the modal appears.
  const editKey = open && issue ? issue.id : null;
  const [hydratedFor, setHydratedFor] = useState<string | null>(editKey);
  if (editKey !== hydratedFor) {
    setHydratedFor(editKey);
    if (editKey) hydrateFromProps();
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
        onClose={() => setOpen(false)}
        ariaLabel={isEdit ? "Edit issue" : "Add issue"}
        size="lg"
      >
        <ModalHeader
          title={isEdit ? "Edit issue" : "Add issue"}
          onClose={() => setOpen(false)}
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
            <Button variant="ghost" onClick={() => setOpen(false)}>
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
    </>
  );
}
