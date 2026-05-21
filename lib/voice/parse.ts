import { z } from "zod";

export const ACTIONS = [
  "create_todo",
  "create_issue",
  "create_rock",
  "update_rock_status",
  "add_milestone",
  "complete_milestone",
] as const;
export type VoiceAction = (typeof ACTIONS)[number];

// A single action item. The speaker may request multiple in one command,
// so the top-level response wraps these in an array.
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
});
export type ActionItem = z.infer<typeof ActionItem>;

export const ParsedItem = z.object({
  actions: z.array(ActionItem).min(1).max(8),
  transcript: z.string().default(""),
});
export type ParsedItem = z.infer<typeof ParsedItem>;

const MODEL = "gemini-2.5-flash";

function quarterOf(date: Date): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

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
  },
  required: ["action"],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    actions: {
      type: "ARRAY",
      items: ACTION_SCHEMA,
    },
    transcript: { type: "STRING" },
  },
  required: ["actions", "transcript"],
};

export async function parseVoiceAudio(args: {
  audioBase64: string;
  mimeType: string;
  memberNames: string[];
  currentUserName: string;
  rocks: { id: string; title: string; status: string }[];
  openMilestones: { id: string; title: string; rock_title: string }[];
  now?: Date;
}): Promise<ParsedItem> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set on this deployment.",
    );
  }

  const now = args.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const quarter = quarterOf(now);

  const rocksList =
    args.rocks.length === 0
      ? "(none)"
      : args.rocks
          .map((r) => `  - ${r.id}: "${r.title}" (status: ${r.status})`)
          .join("\n");

  const milestonesList =
    args.openMilestones.length === 0
      ? "(none)"
      : args.openMilestones
          .map(
            (m) => `  - ${m.id}: "${m.title}" (rock: "${m.rock_title}")`,
          )
          .join("\n");

  const system = [
    "You handle voice commands for an EOS app. The speaker may request ONE or MORE actions in a single utterance — return EVERY requested action as a separate entry in the 'actions' array, in the order spoken.",
    "",
    "Action types:",
    "1. create_todo — discrete task. Fields: title, owner_name, due_date.",
    "2. create_issue — problem/blocker/topic. Fields: title, description.",
    "3. create_rock — quarterly goal (multi-week, 'this quarter', '90-day'). Fields: title, quarter, owner_name, due_date, description.",
    "4. update_rock_status — change an EXISTING rock's status. Fields: rock_id (from list), status, comment. 'off_track' REQUIRES a comment — if the speaker doesn't give a reason, infer one from context if possible; otherwise return comment: null and the server will reject so the user can re-record.",
    "5. add_milestone — add a checklist item to an EXISTING rock. Fields: rock_id (from list), title, owner_name, due_date.",
    "6. complete_milestone — mark an EXISTING open milestone done. Fields: milestone_id (from list).",
    "",
    "Existing rocks:",
    rocksList,
    "",
    "Open milestones:",
    milestonesList,
    "",
    "Rules:",
    `- Today is ${today}. Current quarter is ${quarter}.`,
    "- When the speaker mentions a rock or milestone, pick the matching id from the lists above. Choose the BEST single match. If nothing matches, set the id to null.",
    "- Resolve relative dates ('Friday', 'next week') to absolute YYYY-MM-DD.",
    "- For owner_name, match (case-insensitive) to a team member. 'me', 'I', 'myself' → current user. Null if unspecified.",
    `- Current user: ${args.currentUserName}`,
    `- Team members: ${args.memberNames.join(", ")}`,
    "- title: concise, under 120 chars, strip filler words.",
    "- New rocks default to the current quarter if not stated.",
    "- transcript: the verbatim raw transcription of the whole utterance (lightly cleaned, one string).",
    "- Examples of multi-action utterances:",
    "  - 'add a milestone X to the lending rock AND set it off-track because of vendor delays' → 2 actions.",
    "  - 'mark vendor contract milestone done and remind me to email the team Friday' → 2 actions (complete_milestone + create_todo).",
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: args.mimeType, data: args.audioBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
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

  const json = JSON.parse(text);
  return ParsedItem.parse(json);
}
