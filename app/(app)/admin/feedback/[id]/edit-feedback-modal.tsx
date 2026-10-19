"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  DiscardChangesDialog,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
  draftChanged,
  useDiscardGuard,
} from "@/components/ui/modal";
import { entityHeaderButtonClass } from "@/components/entity-page-header";
import { SHIPPED_STATUSES, changedEditFields, type FeedbackEditForm } from "@/lib/feedback/edit";
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, type FeedbackStatus } from "@/lib/feedback/types";
import { saveFeedbackEdits } from "../actions";
import { Field, Textarea } from "../form-fields";

/**
 * Edit a feedback item's working fields. The reporter's comment, the number
 * and the spreadsheet thread are not here: they are never edited.
 */
export function EditFeedbackButton({
  id,
  label,
  initial,
  updatedAt,
}: {
  id: string;
  label: string;
  initial: FeedbackEditForm;
  /** The item's updated_at as this page loaded it (the save's staleness check). */
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FeedbackEditForm>(initial);
  const [opened, setOpened] = useState<FeedbackEditForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const guard = useDiscardGuard(draftChanged(draft, opened), () => setOpen(false));

  function openForm() {
    // Re-seed from the latest server values every time it opens.
    setDraft(initial);
    setOpened(initial);
    setError(null);
    setOpen(true);
  }

  const set = (k: keyof FeedbackEditForm) => (e: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [k]: e.target.value }));

  const willStampShipped =
    draft.status !== initial.status &&
    SHIPPED_STATUSES.includes(draft.status as FeedbackStatus) &&
    draft.shipped_at.trim() === "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Only what this admin changed: another admin's newer value for any other
    // field is never written back.
    const changes = changedEditFields(draft, opened);
    if (Object.keys(changes).length === 0) {
      setOpen(false);
      return;
    }
    start(async () => {
      setError(null);
      const res = await saveFeedbackEdits(id, changes, updatedAt);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={openForm} className={entityHeaderButtonClass}>
        <Pencil className="h-4 w-4" />
        Edit
      </button>
      <ModalShell
        open={open}
        onClose={guard.requestClose}
        dismissible={!guard.asking}
        ariaLabel={`Edit ${label}`}
        size="3xl"
      >
        <ModalHeader title={`Edit ${label}`} onClose={guard.requestClose} />
        <ModalBody as="form" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="fb-edit-status">
              <Select id="fb-edit-status" value={draft.status} onChange={set("status")} autoFocus>
                {FEEDBACK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {FEEDBACK_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Shipped"
              htmlFor="fb-edit-shipped"
              hint={
                willStampShipped
                  ? "Will be set to today when you save."
                  : "Filled with today when the status moves to Deployed or Completed."
              }
            >
              <Input
                id="fb-edit-shipped"
                // A seeded date-time keeps a text box (a date input cannot show it).
                type={/^\d{4}-\d{2}-\d{2}$/.test(opened.shipped_at) || opened.shipped_at === "" ? "date" : "text"}
                value={draft.shipped_at}
                onChange={set("shipped_at")}
              />
            </Field>
          </div>
          <Field label="Resolution for staff" htmlFor="fb-edit-client-resolution" hint="Client-facing.">
            <Textarea
              id="fb-edit-client-resolution"
              rows={3}
              value={draft.client_resolution}
              onChange={set("client_resolution")}
            />
          </Field>
          <Field
            label="Internal resolution"
            htmlFor="fb-edit-resolution"
            hint="Admins only — never in the client report."
          >
            <Textarea id="fb-edit-resolution" rows={3} value={draft.resolution} onChange={set("resolution")} />
          </Field>
          <Field label="Client note" htmlFor="fb-edit-client-note">
            <Textarea id="fb-edit-client-note" rows={2} value={draft.client_note} onChange={set("client_note")} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Follow up with" htmlFor="fb-edit-follow-up-with">
              <Input id="fb-edit-follow-up-with" value={draft.follow_up_with} onChange={set("follow_up_with")} />
            </Field>
            <Field label="Follow-up topic" htmlFor="fb-edit-follow-up-topic">
              <Input
                id="fb-edit-follow-up-topic"
                value={draft.follow_up_topic}
                onChange={set("follow_up_topic")}
              />
            </Field>
          </div>
          <Field label="Follow-ups" htmlFor="fb-edit-follow-ups" hint="One per line.">
            <Textarea id="fb-edit-follow-ups" rows={3} value={draft.follow_ups} onChange={set("follow_ups")} />
          </Field>
          <Field label="PRs" htmlFor="fb-edit-prs" hint="PR numbers, separated by commas or spaces, e.g. 40, 86.">
            <Input id="fb-edit-prs" value={draft.prs} onChange={set("prs")} inputMode="numeric" />
          </Field>
          <Field label="Evidence" htmlFor="fb-edit-evidence" hint="One per line: PRs, file paths, roadmap rows.">
            <Textarea id="fb-edit-evidence" rows={4} value={draft.evidence} onChange={set("evidence")} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <ModalFooter>
            <Button variant="ghost" onClick={guard.requestClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </ModalFooter>
        </ModalBody>
      </ModalShell>
      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        message={`Your changes to ${label} haven't been saved. Close now and they're gone.`}
      />
    </>
  );
}
