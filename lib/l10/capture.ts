// The live meeting's one "Issue / To-do" capture (feedback row 58): which
// kind a fresh capture opens on, the stage prefix an issue title starts
// with, how switching kind treats the title, and which server action the
// save goes to. Kept free of React so the rules can be tested; the modal is
// app/(app)/teams/[teamId]/meetings/[meetingId]/meeting-capture-modal.tsx.

import type { Segment } from "./segments";

export type CaptureKind = "issue" | "todo";

/**
 * The title an Issue capture starts with on each stage — what the old
 * per-stage "Drop to Issues" boxes prefilled. Issues and Conclude had none
 * (Conclude had no box at all).
 */
export const CAPTURE_ISSUE_PREFIX: Record<Segment, string> = {
  segue: "From segue: ",
  scorecard: "Off-track metric: ",
  rocks: "Off-track rock: ",
  headlines: "From headline: ",
  todos: "Stale to-do: ",
  issues: "",
  conclude: "",
  done: "",
};

/**
 * The kind a capture opens on. The reporting stages surface problems, so
 * they drop issues; Issues is where problems get solved and Conclude recaps
 * the to-dos, so those capture next steps. Applies only when the modal is
 * opened fresh — an open draft keeps its kind as the room moves on.
 */
export function defaultCaptureKind(s: Segment): CaptureKind {
  return s === "issues" || s === "conclude" || s === "done" ? "todo" : "issue";
}

/** The title the form fills in for a kind on a stage ("" for a to-do). */
export function autoTitleFor(kind: CaptureKind, s: Segment): string {
  return kind === "issue" ? CAPTURE_ISSUE_PREFIX[s] : "";
}

/**
 * The title after switching kind. `autoTitle` is what the form last filled
 * in itself: while the title still equals it, nothing has been typed, so the
 * prefix swaps for the new kind's (or clears). Once the title differs, it is
 * the user's text and is never altered.
 */
export function titleAfterKindSwitch({
  title,
  autoTitle,
  to,
  segment,
}: {
  title: string;
  autoTitle: string;
  to: CaptureKind;
  segment: Segment;
}): { title: string; autoTitle: string } {
  if (title !== autoTitle) return { title, autoTitle };
  const next = autoTitleFor(to, segment);
  return { title: next, autoTitle: next };
}

/** A title with nothing in it but the form's own prefix is no title. */
export function captureTitleMissing(title: string, autoTitle: string): boolean {
  return !title.trim() || (autoTitle !== "" && title === autoTitle);
}

export type CaptureDraft = {
  kind: CaptureKind;
  title: string;
  ownerId: string;
  description: string;
  /** To-do only. */
  due: string;
  weeklyFocus: boolean;
  followerIds: string[];
  /** Issue only: "" is no priority. */
  priority: string;
  term: "short" | "long";
};

/**
 * Where a save goes and what it sends: addIssue or addTodo, with the same
 * fields their own forms send (issue-form-modal.tsx, add-todo-modal.tsx with
 * a meetingId). Both carry source_meeting_id so the recap attributes the
 * capture to this L10; the to-do is team-visible, as addTodo forces anyway.
 */
export function captureSubmission(
  draft: CaptureDraft,
  meetingId: string,
): { action: "addIssue" | "addTodo"; fields: [string, string][] } {
  if (draft.kind === "issue") {
    return {
      action: "addIssue",
      fields: [
        ["title", draft.title],
        ["owner_id", draft.ownerId],
        ["priority", draft.priority],
        ["type", draft.term],
        ["description", draft.description],
        ["source_meeting_id", meetingId],
      ],
    };
  }
  const fields: [string, string][] = [
    ["title", draft.title],
    ["owner_id", draft.ownerId],
    ["due_date", draft.due],
    ["visibility", "team"],
    ["description", draft.description],
  ];
  if (draft.weeklyFocus) fields.push(["weekly_focus", "on"]);
  fields.push(["source_meeting_id", meetingId]);
  for (const id of draft.followerIds) fields.push(["follower_ids", id]);
  return { action: "addTodo", fields };
}

/** The capture button's beat of confirmation after a save. */
export const CAPTURE_ADDED_LABEL: Record<CaptureKind, string> = {
  issue: "Added to Issues",
  todo: "Added to To-Dos",
};
