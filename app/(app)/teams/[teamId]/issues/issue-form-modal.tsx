"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { addIssue, updateIssueMeta } from "./actions";
import type { IssueType } from "@/lib/issues";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerPicker } from "@/components/ui/owner-picker";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_TERM_OPTIONS,
  issueOwnerName,
  toPriorityValue,
  type IssuePriorityValue,
} from "./issue-form-options";
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

/** Owner picker props for a team-only list: the org directory is never
 *  fetched, so these stay empty. Module-level so they keep their identity. */
const NO_ORG_PEOPLE = null;
const NO_TEAM_NAMES: ReadonlyMap<string, string> = new Map();
function noOrgNeeded() {}

/** Every field the form owns, in one shape, so "has this been touched?" is a
 *  comparison against the values it opened with rather than five of them. */
type IssueDraft = {
  title: string;
  ownerId: string;
  priority: IssuePriorityValue;
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
    priority: toPriorityValue(issue.priority),
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
  /** The viewer (every caller passes their uid): the create default, and the
   *  one off-roster owner the server accepts besides the one already set. */
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

  const ownerTeam = useMemo(
    () => ({ id: teamId, name: "This team", people: members }),
    [teamId, members],
  );

  // Edit mounts already holding its issue (the parent renders this modal only
  // once a row is being edited), so seed from the issue rather than waiting for
  // the render-time sync below — that sync only fires on a *change* of issue.
  const [mounted] = useState<IssueDraft>(() =>
    draftFrom(issue, defaultOwnerId, defaultType),
  );

  const [title, setTitle] = useState(mounted.title);
  const [ownerId, setOwnerId] = useState(mounted.ownerId);
  const [priority, setPriority] = useState(mounted.priority);
  const [type, setType] = useState<IssueType>(mounted.type);
  const [description, setDescription] = useState(mounted.description);
  // What the fields held when the modal opened. Kept so closing can tell an
  // untouched form (close it, no questions) from one holding typing.
  const [opened, setOpened] = useState<IssueDraft>(mounted);

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
        size="3xl"
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* A div, not a <label>: the picker is a button + popover, and a
                wrapping label would re-click it. The trigger names itself
                ("Owner: …"). */}
            <div className="block space-y-1">
              <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Owner
              </span>
              {/* Team roster only: addIssue / updateIssueMeta reject an owner
                  off the roster (requireRosterOwner), so no Whole org tab. */}
              <OwnerPicker
                variant="field"
                label="Owner"
                allowUnassigned
                teamOnly
                value={ownerId}
                valueName={issueOwnerName(ownerId, members, defaultOwnerId)}
                onChange={setOwnerId}
                team={ownerTeam}
                orgPeople={NO_ORG_PEOPLE}
                onNeedOrg={noOrgNeeded}
                teamNameById={NO_TEAM_NAMES}
              />
            </div>

            <label className="block space-y-1">
              <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Priority
              </span>
              <SelectMenu<IssuePriorityValue>
                variant="field"
                options={ISSUE_PRIORITY_OPTIONS}
                value={priority}
                onChange={setPriority}
              />
            </label>

            <label className="block space-y-1">
              <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Term
              </span>
              <SelectMenu<IssueType>
                variant="field"
                options={ISSUE_TERM_OPTIONS}
                value={type}
                onChange={setType}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Description{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Decision notes, context, links…"
              rows={10}
              textareaClassName="min-h-[14rem] leading-relaxed"
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
