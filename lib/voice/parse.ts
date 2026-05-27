import { z } from "zod";

export const ACTIONS = [
  "create_todo",
  "create_issue",
  "create_rock",
  "update_rock_status",
  "add_milestone",
  "complete_milestone",
  "complete_todo",
] as const;
export type VoiceAction = (typeof ACTIONS)[number];

// A single proposed action. One user message may yield several, so the
// model wraps them in an array. These are PROPOSALS — nothing is applied
// until the user confirms in the UI.
export const ActionItem = z.object({
  action: z.enum(ACTIONS),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  owner_name: z.string().nullable().default(null),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  quarter: z
    .string()
    .regex(/^\d{4}-Q[1-4]$/)
    .nullable()
    .default(null),
  rock_id: z.string().nullable().default(null),
  status: z
    .enum(["on_track", "off_track", "done", "cancelled"])
    .nullable()
    .default(null),
  comment: z.string().nullable().default(null),
  milestone_id: z.string().nullable().default(null),
  todo_id: z.string().nullable().default(null),
});
export type ActionItem = z.infer<typeof ActionItem>;

// One assistant turn: a natural-language reply, plus optional action
// proposals, plus a transcript when the user's turn was spoken.
export const ChatResponse = z.object({
  reply: z.string().default(""),
  actions: z.array(ActionItem).max(8).default([]),
  transcript: z.string().default(""),
});
export type ChatResponse = z.infer<typeof ChatResponse>;

const MODEL = "gemini-2.5-flash";

function quarterOf(date: Date): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

const STATUS_LABEL: Record<string, string> = {
  on_track: "On Track",
  off_track: "Off Track",
  done: "Done",
  cancelled: "Cancelled",
};

const ACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    action: { type: "STRING", enum: [...ACTIONS] },
    title: { type: "STRING", nullable: true },
    description: { type: "STRING", nullable: true },
    owner_name: { type: "STRING", nullable: true },
    due_date: { type: "STRING", nullable: true },
    quarter: { type: "STRING", nullable: true },
    rock_id: { type: "STRING", nullable: true },
    status: {
      type: "STRING",
      enum: ["on_track", "off_track", "done", "cancelled"],
      nullable: true,
    },
    comment: { type: "STRING", nullable: true },
    milestone_id: { type: "STRING", nullable: true },
    todo_id: { type: "STRING", nullable: true },
  },
  required: ["action"],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    actions: { type: "ARRAY", items: ACTION_SCHEMA },
    transcript: { type: "STRING" },
  },
  required: ["reply"],
};

export type ChatTurnInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; audioBase64: string; mimeType: string };

export type ChatContext = {
  memberNames: string[];
  currentUserName: string;
  rocks: { id: string; title: string; status: string; owner: string | null }[];
  openMilestones: { id: string; title: string; rock_title: string }[];
  todos: { id: string; title: string; owner: string | null; due_date: string | null }[];
  issues: { title: string; status: string }[];
  now?: Date;
};

function bullet<T>(items: T[], render: (t: T) => string): string {
  return items.length === 0
    ? "  (none)"
    : items.map((t) => `  - ${render(t)}`).join("\n");
}

function buildSystem(ctx: ChatContext, pending: ActionItem[]): string {
  const now = ctx.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const quarter = quarterOf(now);

  const pendingBlock =
    pending.length === 0
      ? ""
      : [
          "",
          "PENDING PROPOSAL (awaiting the user's confirmation):",
          JSON.stringify(pending),
          "If the user's new message refines this (e.g. 'make it due Friday', 'assign it to Dana', 'add another'), return the COMPLETE updated set of actions reflecting all current intent — not just the change. If they ask for something unrelated, replace it. If they're only chatting or confirming, return an empty actions array.",
        ].join("\n");

  return [
    "You are the assistant inside an EOS (Entrepreneurial Operating System) app used by a community bank team. You do two things:",
    "1) ANSWER questions about the team's rocks, to-dos, issues, and milestones using ONLY the DATA below. If the data doesn't contain the answer, say so briefly — never invent items.",
    "2) PROPOSE changes when the user asks to create or update something. Proposals are NOT applied automatically — the user must confirm them in the UI first. Never claim you've already done it; describe what you WILL do.",
    "",
    "Every turn, return:",
    '- "reply": a short, friendly message. For questions, put the answer here and leave "actions" empty. For change requests, briefly state what you are about to propose.',
    '- "actions": the structured operations to propose (empty array when there is nothing to change).',
    '- "transcript": if the user\'s latest message was spoken audio, the verbatim (lightly cleaned) transcription; otherwise an empty string.',
    "",
    "Action types:",
    "1. create_todo — discrete task. Fields: title, owner_name, due_date.",
    "2. create_issue — problem/blocker/topic for IDS. Fields: title, description.",
    "3. create_rock — quarterly goal ('this quarter', '90-day'). Fields: title, quarter, owner_name, due_date, description.",
    "4. update_rock_status — change an EXISTING rock's status. Fields: rock_id (from list), status, comment. 'off_track' REQUIRES a comment — if the user gives no reason, ask for one in 'reply' and DO NOT emit the action.",
    "5. add_milestone — add a checklist item to an EXISTING rock. Fields: rock_id (from list), title, owner_name, due_date.",
    "6. complete_milestone — mark an EXISTING open milestone done. Fields: milestone_id (from list).",
    "7. complete_todo — mark an EXISTING open to-do done / close it. Fields: todo_id (from the open to-do list).",
    pendingBlock,
    "",
    "DATA",
    `Today is ${today}. Current quarter is ${quarter}.`,
    `Current user: ${ctx.currentUserName}`,
    `Team members: ${ctx.memberNames.length ? ctx.memberNames.join(", ") : "(none)"}`,
    "Rocks (id — title — status — owner):",
    bullet(
      ctx.rocks,
      (r) =>
        `${r.id} — ${r.title} — ${STATUS_LABEL[r.status] ?? r.status}${r.owner ? ` — ${r.owner}` : ""}`,
    ),
    "Open milestones (id — title — rock):",
    bullet(ctx.openMilestones, (m) => `${m.id} — ${m.title} — rock: ${m.rock_title}`),
    "Open to-dos (id — title — owner — due):",
    bullet(
      ctx.todos,
      (t) =>
        `${t.id} — ${t.title}${t.owner ? ` — ${t.owner}` : ""}${t.due_date ? ` — due ${t.due_date}` : ""}`,
    ),
    "Open issues:",
    bullet(ctx.issues, (i) => i.title),
    "",
    "Rules:",
    "- When the user mentions a rock, milestone, or to-do, pick the BEST matching id from the lists above; if nothing matches, set the id to null and say so in the reply.",
    "- Resolve relative dates ('Friday', 'next week') to an absolute YYYY-MM-DD and put it in the action's due_date field — NOT only in the reply. Anything you mention in 'reply' (date, owner, status) MUST be reflected in the matching action field.",
    "- owner_name: match (case-insensitive) to a team member. 'me', 'I', 'myself' → current user. Null if unspecified.",
    "- title: concise, under 120 chars, strip filler words.",
    "- New rocks default to the current quarter if not stated.",
    "- Do NOT emit duplicate or near-duplicate actions. Each distinct change appears at most ONCE. Closing an item and creating a new one are two different actions, not the same one twice.",
    "- Reply formatting: write item titles as plain text with NO surrounding quotation marks, and show statuses as readable words (On Track, Off Track, Done, Cancelled) — never raw codes like on_track. When listing several items, use a simple dash bullet per line.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

// One conversational turn. Sends prior history + the new (typed or spoken)
// message to Gemini and returns a reply plus any proposed actions. Never
// mutates anything — proposals are confirmed separately.
export async function chatRespond(args: {
  history: { role: "user" | "assistant"; text: string }[];
  input: ChatTurnInput;
  pendingActions?: ActionItem[];
  context: ChatContext;
}): Promise<ChatResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set on this deployment.",
    );
  }

  const system = buildSystem(args.context, args.pendingActions ?? []);

  const contents: {
    role: "user" | "model";
    parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[];
  }[] = [];

  for (const m of args.history) {
    if (!m.text.trim()) continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    });
  }

  if (args.input.kind === "text") {
    contents.push({ role: "user", parts: [{ text: args.input.text }] });
  } else {
    contents.push({
      role: "user",
      parts: [
        { inlineData: { mimeType: args.input.mimeType, data: args.input.audioBase64 } },
      ],
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  return ChatResponse.parse(JSON.parse(text));
}
