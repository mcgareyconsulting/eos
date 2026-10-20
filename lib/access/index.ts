// The access modules, one per shape (docs/PERMISSIONS_SPEC.md §3, §6), and
// `accessFor(itemType)` — the one lookup the generic thread / mention /
// follow / notification code (P5, P9) uses instead of knowing types.

import {
  headlineAccess,
  issueAccess,
  teamTodoAccess,
  type HeadlineSubject,
  type IssueSubject,
} from "./team-item";
import { privateTodoAccess, type PrivateTodoSubject } from "./private-item";
import {
  milestoneAccess,
  rockAccess,
  type MilestoneSubject,
  type RockSubject,
} from "./rock";
import { metricAccess, type MetricSubject } from "./metric";
import { feedbackAccess, type FeedbackSubject } from "./feedback";
import type { AccessModule, CompletableAccessModule, ItemType } from "./types";

export * from "./types";
export * from "./team-item";
export * from "./private-item";
export * from "./rock";
export * from "./metric";
export * from "./feedback";

/** A plain to-do (no `source_rock_id`): team (shape A) or private (shape B). */
export type TodoSubject = PrivateTodoSubject;

export function isPrivateTodo(todo: { visibility?: unknown }): boolean {
  return todo.visibility === "private";
}

function todoModule(
  todo: TodoSubject,
): CompletableAccessModule<TodoSubject> {
  return isPrivateTodo(todo) ? privateTodoAccess : teamTodoAccess;
}

/** Shape A or B, picked per document by `visibility`. */
export const todoAccess: CompletableAccessModule<TodoSubject> = {
  canSee: (t, v) => todoModule(t).canSee(t, v),
  canEdit: (t, v) => todoModule(t).canEdit(t, v),
  canComment: (t, v) => todoModule(t).canComment(t, v),
  canFollow: (t, v) => todoModule(t).canFollow(t, v),
  canMention: (t, p) => todoModule(t).canMention(t, p),
  canDelete: (t, v) => todoModule(t).canDelete(t, v),
  canComplete: (t, v) => todoModule(t).canComplete(t, v),
};

/** The subject (document fields) each item type's module reads. */
export type AccessSubjectFor = {
  rock: RockSubject;
  milestone: MilestoneSubject;
  todo: TodoSubject;
  issue: IssueSubject;
  metric: MetricSubject;
  headline: HeadlineSubject;
  feedback: FeedbackSubject;
};

const MODULES: { [K in ItemType]: AccessModule<AccessSubjectFor[K]> } = {
  rock: rockAccess,
  milestone: milestoneAccess,
  todo: todoAccess,
  issue: issueAccess,
  metric: metricAccess,
  headline: headlineAccess,
  feedback: feedbackAccess,
};

/**
 * The access module for an item type. A `todos` doc with `source_rock_id`
 * is a milestone, not a to-do — classify it with `itemTypeOfTodoDoc`
 * (lib/item-registry.ts) first.
 */
export function accessFor<T extends ItemType>(
  type: T,
): AccessModule<AccessSubjectFor[T]> {
  return MODULES[type];
}
