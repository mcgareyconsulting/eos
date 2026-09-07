"use client";

import { RichTextEditor } from "@/components/rich-text-editor";
import { Input, Select } from "@/components/ui/input";

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
