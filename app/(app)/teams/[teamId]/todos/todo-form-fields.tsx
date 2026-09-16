"use client";

import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

export function TodoFormFields({
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

  weeklyFocus,
  onWeeklyFocusChange,

  followers,

  error,
}: {
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

  weeklyFocus: boolean;
  onWeeklyFocusChange: (value: boolean) => void;

  /** The "Add followers" picker. Hidden for a private to-do, which only its
   *  owner can read, let alone follow. `creatorFollows` is the Add form:
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

      <div className="grid grid-cols-2 gap-3">
        <Field label="Owner">
          <Select
            value={ownerId}
            onChange={(e) => onOwnerChange(e.target.value)}
            className={SELECT_FILL}
          >
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name}
              </option>
            ))}
          </Select>
        </Field>

        {showVisibility && (
          <Field label="Visibility">
            <Select
              value={visibility}
              onChange={(e) => onVisibilityChange(e.target.value as "team" | "private")}
              className={SELECT_FILL}
            >
              <option value="team">Team</option>
              <option value="private">Private</option>
            </Select>
          </Field>
        )}
      </div>

      <Field label="Due date">
        <Input
          type="date"
          value={due}
          onChange={(e) => onDueChange(e.target.value)}
          size="sm"
          className={SELECT_FILL}
        />
      </Field>

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
