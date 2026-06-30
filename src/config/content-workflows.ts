// Content workflow registry — the single source of truth for the #content-full
// media → workflow flow. The picker breakdown, the caption keyword router, the
// per-workflow "requirements" messages, and the `/workflows` Slack listing all
// read from this one array, so adding a new format = add one entry here (+ a
// runner case in src/lib/reel/pov-studio.ts).
//
// See plan: finish the #content-full media → workflow flow.

export type ContentWorkflowId = "render" | "animate" | "recreate" | "caption";

export interface ContentWorkflow {
  id: ContentWorkflowId;
  /** Slack reaction name (emoji shortcode) that selects this workflow on the picker. */
  keycap: "one" | "two" | "three" | "four";
  /** Rendered keycap emoji for messages. */
  emoji: string;
  /** Short display name. */
  name: string;
  /** One-line description shown in the picker + /workflows. */
  blurb: string;
  /** Caption keywords that route a media+caption post straight to this workflow. */
  keywords: RegExp;
  /** Human-readable list of what this workflow needs before it can produce output. */
  requirements: string[];
  /** Whether a still frame (image, or a video's thumbnail) is enough to run it. */
  acceptsStillFrame: boolean;
}

export const CONTENT_WORKFLOWS: ContentWorkflow[] = [
  {
    id: "render",
    keycap: "one",
    emoji: "1️⃣",
    name: "Render Reel",
    blurb:
      "I'll write 4 on-screen text lines (label, hook, payoff, cta). Pick or edit them and I render this frame with the text + our 6-second audio into a finished reel.",
    keywords: /\b(render|reel|on.?screen)\b/i,
    requirements: [
      "the 4 on-screen text lines — label, hook, payoff, cta (reply with them one per line, or pick/edit one of the options I post).",
    ],
    acceptsStillFrame: true,
  },
  {
    id: "animate",
    keycap: "two",
    emoji: "2️⃣",
    name: "Animate",
    blurb:
      "I'll give you an animation prompt, a few headline options, and captions to turn this still into a moving clip.",
    keywords: /\b(animate|make it move|motion|bring (it )?to life|moving)\b/i,
    requirements: ["just this still frame — I output the animation prompt, headline options, and captions."],
    acceptsStillFrame: true,
  },
  {
    id: "recreate",
    keycap: "three",
    emoji: "3️⃣",
    name: "Recreate",
    blurb:
      "Treat this as fire inspiration; I'll break down why it works and rebuild it as our pest-control POV with a fresh first frame.",
    keywords: /\b(recreate|remake|copy this|like this|steal this|fire|inspo|inspiration|break ?down)\b/i,
    requirements: ["the inspiration image/video — I break down why it works and rebuild it as our POV."],
    acceptsStillFrame: true,
  },
  {
    id: "caption",
    keycap: "four",
    emoji: "4️⃣",
    name: "Caption",
    blurb:
      "Copy only: I'll write headline options + 3 captions (authority, relatable, curiosity) for this still. No animation, no render.",
    keywords: /\b(caption|title|hook|copy)\b/i,
    requirements: ["just this still frame — I output headline options and captions, no video."],
    acceptsStillFrame: true,
  },
];

/** Reaction name (e.g. "one") → workflow id, derived from the registry. */
export const REACTION_TO_WORKFLOW: Record<string, ContentWorkflowId> = Object.fromEntries(
  CONTENT_WORKFLOWS.map((w) => [w.keycap, w.id])
) as Record<string, ContentWorkflowId>;

export function getWorkflow(id: ContentWorkflowId): ContentWorkflow {
  const w = CONTENT_WORKFLOWS.find((x) => x.id === id);
  if (!w) throw new Error(`unknown content workflow: ${id}`);
  return w;
}

/**
 * Classify a caption into a workflow. Priority: an explicit Recreate/Animate verb
 * wins over the broader Render keywords; null = ambiguous (caller should ask). The
 * complete-4-box-script shortcut lives in pov-studio.ts (it needs parseBoxes).
 */
export function classifyByKeywords(brief: string): ContentWorkflowId | null {
  const text = brief.trim();
  if (!text) return null;
  if (getWorkflow("recreate").keywords.test(text)) return "recreate";
  if (getWorkflow("animate").keywords.test(text)) return "animate";
  if (getWorkflow("caption").keywords.test(text)) return "caption";
  if (getWorkflow("render").keywords.test(text)) return "render";
  return null;
}
