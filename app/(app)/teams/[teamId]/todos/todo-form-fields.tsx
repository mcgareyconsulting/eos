"use client";

import { useId, useRef, useState } from "react";
import { Lock, UserPlus, Users, X } from "lucide-react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TodoOwnerField } from "./todo-owner-field";
import {
  stepChoice,
  todoVisibilityChoices,
  type TodoVisibility,
} from "./todo-visibility";

export type Member = { user_id: string; full_name: string };

const SELECT_FILL = "bg-white dark:bg-zinc-900";

/** Field column shared by the add-to-do modal and the edit-to-do drawer. */
function Field({
  label,
  required,
  children,
}: {
  label: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * Who hears about this to-do. `impliedIds` follow whether or not they are
 * named here — the owner always, and on the Add form the creator too
 * (lib/notifications.ts initialFollowers) — so they show as fixed chips;
 * "Add followers" opens a checklist of everyone else on the roster. On the
 * Edit form the current followers seed the picks, so unchecking someone is
 * how they get removed.
 */
function FollowerPicker({
  members,
  currentUserId,
  impliedIds,
  value,
  onChange,
}: {
  members: Member[];
  currentUserId: string;
  impliedIds: string[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const nameOf = (uid: string) =>
    uid === currentUserId
      ? "You"
      : (members.find((m) => m.user_id === uid)?.full_name ?? "—");
  const implied = impliedIds.filter(
    (id, i, all) => id && all.indexOf(id) === i,
  );
  const candidates = members.filter((m) => !implied.includes(m.user_id));
  const chosen = value.filter((id) => !implied.includes(id));

  function toggle(uid: string, on: boolean) {
    onChange(on ? [...chosen, uid] : chosen.filter((id) => id !== uid));
  }

  const chipClass =
    "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {implied.map((uid) => (
        <span
          key={uid}
          title="Follows automatically"
          className={cn(
            chipClass,
            "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
          )}
        >
          {nameOf(uid)}
        </span>
      ))}
      {chosen.map((uid) => (
        <span
          key={uid}
          className={cn(
            chipClass,
            "bg-hpb-blue/10 pr-1 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold",
          )}
        >
          {nameOf(uid)}
          <button
            type="button"
            onClick={() => toggle(uid, false)}
            aria-label={`Remove ${nameOf(uid)} as a follower`}
            className="rounded-full p-0.5 hover:bg-hpb-blue/15 dark:hover:bg-hpb-gold/20"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {candidates.length > 0 && (
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          aria-expanded={picking}
          className={cn(
            chipClass,
            "border border-dashed border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
          )}
        >
          <UserPlus className="h-3 w-3" />
          {picking ? "Done" : "Add followers"}
        </button>
      )}
      {picking && (
        <ul className="mt-1 w-full max-h-40 overflow-y-auto rounded-md border border-zinc-200 py-1 dark:border-zinc-800">
          {candidates.map((m) => {
            const on = chosen.includes(m.user_id);
            return (
              <li key={m.user_id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(m.user_id, e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-hpb-blue focus:ring-hpb-blue/40 dark:border-zinc-700"
                  />
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {nameOf(m.user_id)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const VISIBILITY_ICON: Record<TodoVisibility, typeof Users> = {
  team: Users,
  private: Lock,
};

/**
 * Team / Private as a segmented toggle — the same two-button shape as the
 * rock modal's Individual / Team kind, rather than a dropdown: with two
 * choices both stay in view and one click switches, and the line under it
 * says who can see the to-do for the choice that is on (the wording lives in
 * ./todo-visibility.ts, from the permissions spec). A radiogroup with a
 * roving tab stop: Tab lands on the checked choice, arrows move and select.
 * The value reaches the server the same way as before (the modal's own
 * FormData `visibility`, "team" | "private").
 */
function VisibilityToggle({
  value,
  onChange,
  canPublish,
  creatorId,
  ownerId,
  viewerId,
}: {
  value: TodoVisibility;
  onChange: (value: TodoVisibility) => void;
  canPublish: boolean;
  creatorId: string | null;
  ownerId: string;
  viewerId: string;
}) {
  const labelId = useId();
  const descId = useId();
  const refs = useRef<Partial<Record<TodoVisibility, HTMLButtonElement | null>>>({});
  const choices = todoVisibilityChoices({ canPublish, creatorId, ownerId, viewerId });
  const current = choices.find((c) => c.value === value) ?? choices[0];

  function onKeyDown(e: React.KeyboardEvent) {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    const next = stepChoice(choices, value, delta);
    if (next !== value) onChange(next);
    refs.current[next]?.focus();
  }

  return (
    // A div, not Field's <label>: a label forwards clicks on its text to its
    // first button, so clicking the help line would flip the value.
    <div className="block">
      <span
        id={labelId}
        className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
      >
        Visibility
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="flex h-8 rounded-md border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {choices.map((c) => {
          const Icon = VISIBILITY_ICON[c.value];
          const checked = c.value === value;
          return (
            <button
              key={c.value}
              ref={(el) => {
                refs.current[c.value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={c.disabled}
              tabIndex={checked ? 0 : -1}
              onClick={() => {
                if (!checked) onChange(c.value);
              }}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-3 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
                checked
                  ? "bg-hpb-blue text-white"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                c.disabled &&
                  "cursor-not-allowed opacity-50 hover:bg-transparent dark:hover:bg-transparent",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {c.label}
            </button>
          );
        })}
      </div>
      <span
        id={descId}
        className="mt-1 block text-[11px] leading-snug text-zinc-500"
      >
        {current.description}
        {!canPublish && " Only its creator or owner can share it with the team."}
      </span>
    </div>
  );
}

export function TodoFormFields({
  teamId,
  members,

  title,
  onTitleChange,

  description,
  onDescriptionChange,

  ownerId,
  onOwnerChange,

  due,
  onDueChange,

  showVisibility = true,
  visibility,
  onVisibilityChange,
  canPublish = true,
  viewerId,
  creatorId,

  weeklyFocus,
  onWeeklyFocusChange,

  followers,

  error,
}: {
  /** The to-do's team — the owner picker's first tab. */
  teamId: string;
  members: Member[];

  title: string;
  onTitleChange: (value: string) => void;

  description: string;
  onDescriptionChange: (value: string) => void;

  ownerId: string;
  onOwnerChange: (value: string) => void;

  due: string;
  onDueChange: (value: string) => void;

  /** Create hides visibility when the to-do is tagged to a meeting (forced to team). */
  showVisibility?: boolean;
  visibility: "team" | "private";
  onVisibilityChange: (value: "team" | "private") => void;
  /** False on a private to-do the viewer neither created nor owns (an
   *  admin): only the creator or the owner may share it (spec §3.2). */
  canPublish?: boolean;
  /** The signed-in user, and who created the to-do (the viewer, on Add;
   *  null on a legacy to-do with no `created_by`). The Private help line
   *  names exactly who can see it, from the viewer's seat. */
  viewerId: string;
  creatorId: string | null;

  weeklyFocus: boolean;
  onWeeklyFocusChange: (value: boolean) => void;

  /** The "Add followers" picker. Hidden for a private to-do, which only its
   *  creator and owner can read — and both already follow it. `creatorFollows` is the Add form:
   *  the signed-in user is about to become the creator, who always follows. */
  followers?: {
    currentUserId: string;
    creatorFollows: boolean;
    value: string[];
    onChange: (ids: string[]) => void;
  };

  error?: string | null;
}) {
  return (
    <>
      <Field label="Title" required>
        <Input
          autoFocus
          ring
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </Field>

      <Field label="Description">
        <RichTextEditor
          value={description}
          onChange={onDescriptionChange}
          placeholder="Notes or context"
          rows={4}
        />
      </Field>

      {/* Owner on its own full-width row, so the directory picker's trigger
          has room for the name. A div, not Field's <label>: the picker is a
          button + popover, and a wrapping label would re-click it. */}
      <div className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Owner
        </span>
        <TodoOwnerField
          teamId={teamId}
          members={members}
          value={ownerId}
          onChange={onOwnerChange}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Due date">
          <Input
            type="date"
            value={due}
            onChange={(e) => onDueChange(e.target.value)}
            size="sm"
            className={SELECT_FILL}
          />
        </Field>

        {/* Hidden on a to-do captured in an L10 (add-todo-modal.tsx passes
            showVisibility={!meetingId} and submits "team"): a private to-do
            never shows on the L10 it was made in (spec §3.2). */}
        {showVisibility && (
          <VisibilityToggle
            value={visibility}
            onChange={onVisibilityChange}
            canPublish={canPublish}
            creatorId={creatorId}
            ownerId={ownerId}
            viewerId={viewerId}
          />
        )}
      </div>

      {followers && visibility !== "private" && (
        <div className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Followers
            <span className="ml-1 font-normal text-zinc-400">
              · get notified about comments, completion and edits
            </span>
          </span>
          <FollowerPicker
            members={members}
            currentUserId={followers.currentUserId}
            impliedIds={
              followers.creatorFollows
                ? [followers.currentUserId, ownerId]
                : [ownerId]
            }
            value={followers.value}
            onChange={followers.onChange}
          />
        </div>
      )}

      <label className="flex items-start gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <input
          type="checkbox"
          checked={weeklyFocus}
          onChange={(e) => onWeeklyFocusChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-hpb-blue focus:ring-hpb-blue/40 dark:border-zinc-700"
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Weekly focus
          </span>
          <span className="block text-[11px] text-zinc-500">
            Shows a “Weekly” pill on the row. Replaces marking the title with{" "}
            <code>**</code>.
          </span>
        </span>
      </label>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </>
  );
}
