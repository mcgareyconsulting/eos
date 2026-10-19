"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox, SelectMenu } from "@/components/ui/select-menu";
import {
  DiscardChangesDialog,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalShell,
  draftChanged,
  useDiscardGuard,
} from "@/components/ui/modal";
import { entityAddButtonClass } from "@/components/entity-page-header";
import { bankToday } from "@/lib/feedback/edit";
import { FEEDBACK_TYPES, FEEDBACK_TYPE_LABELS } from "@/lib/feedback/types";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS = FEEDBACK_TYPES.map((t) => ({ value: t, label: FEEDBACK_TYPE_LABELS[t] }));
import { createFeedback } from "./actions";
import { Field, Textarea } from "./form-fields";

type Draft = {
  reported_on: string;
  reviewer: string;
  page: string;
  type: string;
  summary: string;
  original_comment: string;
};

function emptyDraft(): Draft {
  return {
    reported_on: bankToday(),
    reviewer: "",
    page: "",
    type: "bug",
    summary: "",
    original_comment: "",
  };
}

/**
 * Log feedback: text only in v1 (no screenshot upload, no followers). The
 * new item starts as New, numbered after the highest existing one, and
 * opens in the detail modal (`onCreated`).
 */
export function NewFeedbackButton({
  pages,
  reviewers,
  onCreated,
}: {
  pages: string[];
  reviewers: string[];
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [opened, setOpened] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const guard = useDiscardGuard(draftChanged(draft, opened), () => setOpen(false));

  function openForm() {
    const d = emptyDraft();
    setDraft(d);
    setOpened(d);
    setError(null);
    setOpen(true);
  }

  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      setError(null);
      const res = await createFeedback(draft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      onCreated(res.id);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openForm}
        aria-label="Log feedback"
        className={cn(entityAddButtonClass, "min-w-0 px-3")}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Feedback
      </button>
      <ModalShell
        open={open}
        onClose={guard.requestClose}
        dismissible={!guard.asking}
        ariaLabel="Log feedback"
        size="2xl"
      >
        <ModalHeader title="Log feedback" onClose={guard.requestClose} />
        <ModalBody as="form" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Reported by" htmlFor="fb-new-reviewer">
              <Combobox
                id="fb-new-reviewer"
                options={reviewers}
                value={draft.reviewer}
                onChange={(v) => setDraft((prev) => ({ ...prev, reviewer: v }))}
                placeholder="Who reported it"
                createLabel={(text) => <>New reporter “{text}”</>}
                required
                autoFocus
              />
            </Field>
            <Field label="Date reported" htmlFor="fb-new-date">
              <Input
                id="fb-new-date"
                type="date"
                value={draft.reported_on}
                onChange={set("reported_on")}
                required
              />
            </Field>
            <Field label="Page" htmlFor="fb-new-page">
              <Combobox
                id="fb-new-page"
                options={pages}
                value={draft.page}
                onChange={(v) => setDraft((prev) => ({ ...prev, page: v }))}
                placeholder="e.g. Rocks, Scorecard"
                createLabel={(text) => <>New page “{text}”</>}
                required
              />
            </Field>
            <Field label="Type" htmlFor="fb-new-type">
              <SelectMenu
                id="fb-new-type"
                variant="field"
                options={TYPE_OPTIONS}
                value={draft.type}
                onChange={(v) => setDraft((prev) => ({ ...prev, type: v }))}
              />
            </Field>
          </div>
          <Field label="Summary" htmlFor="fb-new-summary" hint="One line. Optional — you can add it later.">
            <Input id="fb-new-summary" value={draft.summary} onChange={set("summary")} />
          </Field>
          <Field
            label="Comment"
            htmlFor="fb-new-comment"
            hint="The reporter's words, verbatim. This can't be edited after it is logged."
          >
            <Textarea
              id="fb-new-comment"
              rows={5}
              value={draft.original_comment}
              onChange={set("original_comment")}
              required
            />
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
              {pending ? "Logging…" : "Log feedback"}
            </Button>
          </ModalFooter>
        </ModalBody>
      </ModalShell>
      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        message="This feedback hasn't been logged. Close now and it's gone."
      />
    </>
  );
}
