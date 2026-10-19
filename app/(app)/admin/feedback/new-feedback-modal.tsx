"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { entityAddButtonClass } from "@/components/entity-page-header";
import { bankToday } from "@/lib/feedback/edit";
import { FEEDBACK_TYPES, FEEDBACK_TYPE_LABELS } from "@/lib/feedback/types";
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
 * new item starts as New, numbered after the highest existing one.
 */
export function NewFeedbackButton({ pages, reviewers }: { pages: string[]; reviewers: string[] }) {
  const router = useRouter();
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
      router.push(`/admin/feedback/${res.id}`);
    });
  }

  return (
    <>
      <button type="button" onClick={openForm} className={entityAddButtonClass}>
        <Plus className="h-4 w-4" />
        Log feedback
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
              <Input
                id="fb-new-reviewer"
                value={draft.reviewer}
                onChange={set("reviewer")}
                list="fb-new-reviewers"
                required
                autoFocus
              />
              <datalist id="fb-new-reviewers">
                {reviewers.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
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
              <Input
                id="fb-new-page"
                value={draft.page}
                onChange={set("page")}
                list="fb-new-pages"
                required
              />
              <datalist id="fb-new-pages">
                {pages.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label="Type" htmlFor="fb-new-type">
              <Select id="fb-new-type" value={draft.type} onChange={set("type")}>
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FEEDBACK_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
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
