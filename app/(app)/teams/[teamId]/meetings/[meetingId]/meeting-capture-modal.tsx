"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { daysFromNow } from "@/lib/dates";
import type { IssueType } from "@/lib/issues";
import {
  captureModalMounted,
  stageOffersCapture,
  type Segment,
} from "@/lib/l10/segments";
import {
  CAPTURE_ADDED_LABEL,
  autoTitleFor,
  captureSubmission,
  captureTitleMissing,
  defaultCaptureKind,
  titleAfterKindSwitch,
  type CaptureKind,
} from "@/lib/l10/capture";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerPicker } from "@/components/ui/owner-picker";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  DiscardChangesDialog,
  draftChanged,
  ModalShell,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDiscardGuard,
} from "@/components/ui/modal";
import { addIssue } from "../../issues/actions";
import {
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_TERM_OPTIONS,
  issueOwnerName,
  type IssuePriorityValue,
} from "../../issues/issue-form-options";
import { addTodo } from "../../todos/actions";
import {
  Field,
  FollowerPicker,
  WeeklyFocusField,
  type Member,
} from "../../todos/todo-form-fields";
import { TodoOwnerField } from "../../todos/todo-owner-field";

/** Owner picker props for the issue's team-only list (see IssueFormModal). */
const NO_ORG_PEOPLE = null;
const NO_TEAM_NAMES: ReadonlyMap<string, string> = new Map();
function noOrgNeeded() {}

/** Every field but the title and the kind — see `dirty` below. */
type CaptureFields = {
  ownerId: string;
  description: string;
  due: string;
  weeklyFocus: boolean;
  followerIds: string[];
  priority: IssuePriorityValue;
  term: IssueType;
};

function freshFields(defaultOwnerId: string): CaptureFields {
  return {
    ownerId: defaultOwnerId,
    description: "",
    due: daysFromNow(7),
    weeklyFocus: false,
    followerIds: [],
    priority: "",
    term: "short",
  };
}

const KINDS: { value: CaptureKind; label: string }[] = [
  { value: "issue", label: "Issue" },
  { value: "todo", label: "To-do" },
];

/** What a stage's CaptureButton needs from the page-level capture. */
type CaptureController = {
  /** The stage on screen — decides whether the button renders. */
  segment: Segment;
  /** Open the modal fresh for the current stage. */
  open: () => void;
  /** Set for a beat after a save — the button's green confirmation. */
  added: CaptureKind | null;
};

const CaptureContext = createContext<CaptureController | null>(null);

/**
 * The live meeting's one capture (feedback row 58): the "Issue / To-do"
 * button in each stage's toolbar opens it. Replaces both the header's Add
 * to-do and the per-stage "Drop to Issues" boxes. An Issue / To-do toggle at
 * the top picks the fields and where Save goes (addIssue or addTodo —
 * lib/l10/capture.ts); each action runs its own permission checks, unchanged.
 *
 * ONE modal, owned here and mounted by the page for the whole meeting
 * (captureModalMounted) — never one per stage. The stage toolbars only hold
 * a CaptureButton that calls open() through context, so a draft — kind and
 * text — survives the room advancing even though the toolbar it was opened
 * from unmounts. `segment` is read when the modal opens (default kind, title
 * prefix) and when the kind is switched, never to rewrite an open draft.
 */
export function MeetingCaptureProvider({
  teamId,
  meetingId,
  members,
  currentUserId,
  segment,
  children,
}: {
  teamId: string;
  meetingId: string;
  members: Member[];
  /** The signed-in user — the default owner and an implied follower. */
  currentUserId: string;
  /** The stage on screen. */
  segment: Segment;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<CaptureKind>("issue");
  const [title, setTitle] = useState("");
  // What the form last filled into the title itself (a stage prefix, or
  // ""). The title still equal to it means nothing has been typed.
  const [autoTitle, setAutoTitle] = useState("");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [description, setDescription] = useState("");
  const [due, setDue] = useState(daysFromNow(7));
  const [weeklyFocus, setWeeklyFocus] = useState(false);
  const [followerIds, setFollowerIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<IssuePriorityValue>("");
  const [term, setTerm] = useState<IssueType>("short");
  const [opened, setOpened] = useState<CaptureFields>(() =>
    freshFields(currentUserId),
  );

  // Success feedback on the trigger: the capture usually lands on a stage
  // other than the one on screen, and without a beat of confirmation people
  // click Add twice and file duplicates (the old QuickAddIssue's lesson).
  const [added, setAdded] = useState<CaptureKind | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  const ownerTeam = useMemo(
    () => ({ id: teamId, name: "This team", people: members }),
    [teamId, members],
  );

  function hydrate(nextKind: CaptureKind) {
    const fields = freshFields(currentUserId);
    const t = autoTitleFor(nextKind, segment);
    setKind(nextKind);
    setTitle(t);
    setAutoTitle(t);
    setOwnerId(fields.ownerId);
    setDescription(fields.description);
    setDue(fields.due);
    setWeeklyFocus(fields.weeklyFocus);
    setFollowerIds(fields.followerIds);
    setPriority(fields.priority);
    setTerm(fields.term);
    setOpened(fields);
    setError(null);
  }

  function openModal() {
    hydrate(defaultCaptureKind(segment));
    setOpen(true);
  }

  function switchKind(to: CaptureKind) {
    if (to === kind) return;
    const next = titleAfterKindSwitch({ title, autoTitle, to, segment });
    setTitle(next.title);
    setAutoTitle(next.autoTitle);
    setKind(to);
    setError(null);
  }

  // Flipping the toggle, or a prefix the form filled in, is not typing worth
  // a discard confirm; anything else that moved off its opening value is.
  const dirty =
    title !== autoTitle ||
    draftChanged(
      { ownerId, description, due, weeklyFocus, followerIds, priority, term },
      opened,
    );
  // Backdrop, Escape, ×, and Cancel all go through this — see useDiscardGuard.
  const guard = useDiscardGuard(dirty, () => setOpen(false));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (captureTitleMissing(title, autoTitle)) {
      setError("Title required");
      return;
    }
    const savedKind = kind;
    const { action, fields } = captureSubmission(
      {
        kind,
        title,
        ownerId,
        description,
        due,
        weeklyFocus,
        followerIds,
        priority,
        term,
      },
      meetingId,
    );
    const fd = new FormData();
    for (const [k, v] of fields) fd.append(k, v);

    start(async () => {
      try {
        setError(null);
        await (action === "addIssue" ? addIssue : addTodo)(teamId, fd);
        setOpen(false);
        hydrate(defaultCaptureKind(segment));
        if (addedTimer.current) clearTimeout(addedTimer.current);
        setAdded(savedKind);
        addedTimer.current = setTimeout(() => setAdded(null), 2500);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const noun = kind === "issue" ? "issue" : "to-do";

  const controller: CaptureController = { segment, open: openModal, added };

  return (
    <CaptureContext.Provider value={controller}>
      {children}

      {captureModalMounted(segment) && (
        <>
          <ModalShell
            open={open}
            onClose={guard.requestClose}
            // Escape belongs to the discard confirm while it is up.
            dismissible={!guard.asking}
            ariaLabel={`Add ${noun}`}
            size="3xl"
          >
            <ModalHeader title={`Add ${noun}`} onClose={guard.requestClose} />

            <ModalBody as="form" onSubmit={submit}>
              {/* Issue / To-do as two pressed-state buttons. Switching keeps
                  title, owner and notes; an untouched stage prefix swaps with
                  the kind (lib/l10/capture.ts titleAfterKindSwitch). */}
              <div
                role="group"
                aria-label="Add as"
                className="flex h-8 w-fit rounded-md border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {KINDS.map((k) => {
                  const on = k.value === kind;
                  return (
                    <button
                      key={k.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => switchKind(k.value)}
                      className={cn(
                        "inline-flex items-center justify-center rounded px-4 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
                        on
                          ? "bg-hpb-blue text-white"
                          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                      )}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>

              {/* One Title input for both kinds, never remounted by the toggle,
                  so focus and the caret stay put. Enter submits the form. */}
              <Field label="Title" required>
                <Input
                  autoFocus
                  ring
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === "issue" ? "Issue (one line)" : undefined}
                />
              </Field>

              <Field label="Description">
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder="Notes or context"
                  rows={4}
                />
              </Field>

              {/* A div, not Field's <label>: the pickers are a button + popover,
                  and a wrapping label would re-click them. */}
              <div className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Owner
                </span>
                {kind === "todo" ? (
                  // Directory search: a to-do may go to anyone (spec §2.3).
                  <TodoOwnerField
                    teamId={teamId}
                    members={members}
                    value={ownerId}
                    onChange={setOwnerId}
                  />
                ) : (
                  // Team roster only: addIssue rejects an owner off the roster
                  // (requireRosterOwner), so no Whole org tab.
                  <OwnerPicker
                    variant="field"
                    label="Owner"
                    allowUnassigned
                    teamOnly
                    value={ownerId}
                    valueName={issueOwnerName(ownerId, members, currentUserId)}
                    onChange={setOwnerId}
                    team={ownerTeam}
                    orgPeople={NO_ORG_PEOPLE}
                    onNeedOrg={noOrgNeeded}
                    teamNameById={NO_TEAM_NAMES}
                  />
                )}
              </div>

              {kind === "issue" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Term
                    </span>
                    <SelectMenu<IssueType>
                      variant="field"
                      options={ISSUE_TERM_OPTIONS}
                      value={term}
                      onChange={setTerm}
                    />
                  </label>
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
                </div>
              ) : (
                <>
                  {/* No visibility choice: a to-do captured in an L10 is always
                      team-visible (addTodo forces it; spec §3.2). */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Due date">
                      <Input
                        type="date"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                        size="sm"
                        className="bg-white dark:bg-zinc-900"
                      />
                    </Field>
                  </div>

                  <div className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Followers
                      <span className="ml-1 font-normal text-zinc-400">
                        · get notified about comments, completion and edits
                      </span>
                    </span>
                    <FollowerPicker
                      members={members}
                      currentUserId={currentUserId}
                      impliedIds={[currentUserId, ownerId]}
                      value={followerIds}
                      onChange={setFollowerIds}
                    />
                  </div>

                  <WeeklyFocusField value={weeklyFocus} onChange={setWeeklyFocus} />
                </>
              )}

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}

              <ModalFooter>
                <Button variant="ghost" onClick={guard.requestClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Adding…" : `Add ${noun}`}
                </Button>
              </ModalFooter>
            </ModalBody>
          </ModalShell>

          <DiscardChangesDialog
            open={guard.asking}
            onKeepEditing={guard.keepEditing}
            onDiscard={guard.discard}
            message={`This ${noun} hasn't been added yet. Close now and what you've typed is gone.`}
          />
        </>
      )}
    </CaptureContext.Provider>
  );
}

/**
 * The stage toolbar's "Issue / To-do": an outlined button, right after the
 * Active | Archived toggle where the old "Drop to Issues" sat, with the same
 * look and the same green beat after a save. It only asks the page-level
 * MeetingCaptureProvider to open; renders nothing outside a live meeting or
 * on a stage without capture (Segue — stageOffersCapture).
 */
export function CaptureButton() {
  const capture = useContext(CaptureContext);
  if (!capture || !stageOffersCapture(capture.segment)) return null;
  const { added, open } = capture;
  return (
    <button
      type="button"
      onClick={open}
      title="Capture an issue or a to-do from this stage"
      className={cn(
        // Same height, padding and type as the Active | Archived toggle and the
        // stage's own add button beside it (h-8, px-3, text-sm); outlined, not filled.
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2",
        added
          ? "border-hpb-green/40 bg-hpb-green/10 text-hpb-green focus-visible:ring-hpb-green/40"
          : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 focus-visible:ring-hpb-blue/40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
      )}
    >
      {added ? (
        <>
          <Check className="h-3.5 w-3.5" />
          {CAPTURE_ADDED_LABEL[added]}
        </>
      ) : (
        <>
          <Plus className="h-3.5 w-3.5" />
          Issue / To-do
        </>
      )}
    </button>
  );
}
