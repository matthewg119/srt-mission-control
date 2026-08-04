// The dream-lead image prompt: page 1 of the pitch doc and the first thing on screen in the Loom.
//
// The Loom opens on ONE inquiry arriving in the owner's real world — the exact kind of lead the
// work is pointed at — and the whole cold open is spent walking it: who they are, the detail that
// implies the ticket, and the line "I asked ChatGPT for X and {Business} came up". That last
// sentence is the mechanism living inside the dream, which is why it is non-negotiable.
//
// HONESTY, and this is the rule the whole file bends around: the image is the TARGET, never a
// result. On camera it is introduced as "this is the exact kind of inquiry we point at your
// phone" and never as a lead that already came in. Everything about the present (the scorecard,
// the live run, robots.txt) is a real screenshot from today's run. AI generates the future only.
// Getting that backwards is fabricating a testimonial.
//
// What this file will NOT invent:
//   - The business name. `client_name` null means classification never resolved a name, and an
//     image whose one legible word is a guess is worse than no image. It refuses instead.
//   - Dollar figures. The ticket is implied through concrete detail (square footage, number of
//     properties, treatment type, headcount) because a number on screen is a promise.
//   - A named competitor who failed them. The lead may say they tried "another company" — saying
//     WHICH one would be inventing a story about a real business.

import { callClaudeJSON } from "@/lib/claude-calls";
import { lintDraft } from "./draft-linter";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

/**
 * Which surface the inquiry lands on.
 *
 * The first four are the ones `choosePreset` picks between automatically by trade. CRM_CARD and
 * TEXT_THREAD exist only to be chosen by hand from the `loom` wizard's six-idea card: they are
 * real inbound surfaces, but neither is ever the safe automatic default (not every owner runs a
 * CRM, and a texted inquiry is a claim about how that business takes leads).
 */
export type Preset = "PHONE_ALERT" | "INBOX_FORM" | "SPLIT_SCREEN" | "BOOKING_ALERT" | "CRM_CARD" | "TEXT_THREAD";

/**
 * Which surface this owner actually watches.
 *
 * Ordered most-specific first: a "medical spa" is aesthetic before it is anything else, and a
 * "commercial landscaping" business is a B2B bid before it is a field service. First match wins,
 * so the order here is the rule.
 */
// NOTE: these deliberately have a leading \b and NO trailing one, so every entry is a PREFIX
// match. A trailing \b would apply to the whole alternation and silently break every stem in the
// list — "manufactur" would not match "manufacturing", "dentist" would not match "dentistry",
// and "property manage" would not match "property management", which is exactly the bug this
// comment exists to stop someone reintroducing.
const PRESET_RULES: Array<{ preset: Preset; re: RegExp; why: string }> = [
  {
    preset: "SPLIT_SCREEN",
    re: /\b(?:dental|dentist|orthodont|invisalign|implant|medical|med[\s-]?spa|aesthetic|esthetic|dermatolog|plastic surgery|cosmetic|clinic|wellness|trt|hormone|botox|filler|weight loss|chiroprac|physical therapy|veterinar)/i,
    why: "medical, dental and aesthetic buyers arrive as a qualified lead form, and the owner checks the phone alert too",
  },
  {
    preset: "BOOKING_ALERT",
    re: /\b(?:restaurant|cater|venue|banquet|event space|bakery|brewer|winery|hotel|cafe|food truck)/i,
    why: "the owner lives in the booking and order alerts",
  },
  {
    preset: "INBOX_FORM",
    re: /\b(?:commercial|industrial|b2b|wholesale|manufactur|property manag|facilit|janitorial|distribut|supplier|contractor services|fleet|logistic|engineering|construction manag)/i,
    why: "commercial and B2B bids arrive by email, and that owner works from the inbox",
  },
];

/** Field services and everything unclassified. That owner lives on the phone. */
const DEFAULT_PRESET: Preset = "PHONE_ALERT";

export function choosePreset(report: Pick<AuditReportRow, "business_type" | "vertical_slug" | "buyer_persona">): {
  preset: Preset;
  why: string;
} {
  const haystack = `${report.business_type ?? ""} ${report.vertical_slug ?? ""} ${report.buyer_persona ?? ""}`;
  for (const rule of PRESET_RULES) {
    if (rule.re.test(haystack)) return { preset: rule.preset, why: rule.why };
  }
  return { preset: DEFAULT_PRESET, why: "field-service and local-service owners live on the phone" };
}

export const PRESET_ALIASES: Record<string, Preset> = {
  phone: "PHONE_ALERT",
  inbox: "INBOX_FORM",
  form: "INBOX_FORM",
  split: "SPLIT_SCREEN",
  booking: "BOOKING_ALERT",
  order: "BOOKING_ALERT",
  crm: "CRM_CARD",
  dashboard: "CRM_CARD",
  text: "TEXT_THREAD",
  sms: "TEXT_THREAD",
};

/** The scene block for the chosen preset. Only one ever ships, so nothing is left to delete. */
function sceneObjective(preset: Preset, business: string): string {
  switch (preset) {
    case "PHONE_ALERT":
      return `A hand holding an iPhone, outdoors near a work truck or at a kitchen counter, in natural light. The screen is in sharp focus and shows a just-opened new-inquiry notification or email addressed to ${business}. Everything outside the screen is softly blurred, shallow depth of field.`;
    case "INBOX_FORM":
      return `A realistic desktop email inbox (Gmail or Outlook style) with one website contact-form submission open, addressed to ${business}. Believable browser chrome, labels and tags visible, an office softly blurred behind.`;
    case "SPLIT_SCREEN":
      return `A split composition. LEFT SIDE: a realistic lead-form submission branded ${business}, with clearly labeled fields. RIGHT SIDE: an iPhone lock screen showing the same lead arriving as a notification for ${business}, with two or three small qualification badges.`;
    case "BOOKING_ALERT":
      return `A phone held in one hand showing a large incoming booking or order notification for ${business}, with the order details, headcount and date visible on screen.`;
    case "CRM_CARD":
      return `A laptop or desktop monitor showing one new lead open as a card in a simple, believable CRM or jobs dashboard branded ${business}. The card shows the inquiry text alongside clearly labeled fields down one side, with a plain list of other jobs behind it. Realistic interface, no invented product logos, an office softly blurred behind the screen.`;
    case "TEXT_THREAD":
      return `A hand holding a phone showing a text message conversation, opened to a new thread from an unknown number. The customer has sent one long message asking about work, and there is a short reply bubble from ${business} underneath. The business name is visible at the top of the thread as the contact or business label. Natural light, everything outside the screen softly blurred.`;
  }
}

export interface DreamLeadVariables {
  businessName: string;
  city: string | null;
  niche: string;
  avatar: string;
  ticketSignal: string;
  avatarQuestion: string;
  leadLanguage: "English" | "Español";
  failedCompetitor: boolean;
  attachments: string;
}

export interface DreamLeadResult {
  ok: true;
  preset: Preset;
  presetWhy: string;
  variables: DreamLeadVariables;
  /** Paste-ready. Every variable already substituted; no placeholder survives. */
  prompt: string;
}

export interface DreamLeadRefusal {
  ok: false;
  reason: string;
}

/** The money questions they are absent from, which is where the dream lead comes from. */
function absentMoneyQuestions(view: ReportView): string[] {
  return view.prompts
    .filter((p) => !p.appeared && !p.isBranded && (p.block === "SERVICIO" || p.block === "COMPARATIVO"))
    .map((p) => p.prompt)
    .slice(0, 8);
}

function renderPrompt(v: DreamLeadVariables, preset: Preset): string {
  const where = v.city ? ` in ${v.city}` : "";
  // The presets whose whole point is labeled fields. TEXT_THREAD and the two notification
  // presets are deliberately excluded: a phone alert with a field table on it is not a thing
  // anyone has ever seen, and the uncanny detail is what makes an image read as generated.
  const formFields =
    preset === "SPLIT_SCREEN" || preset === "INBOX_FORM" || preset === "CRM_CARD"
      ? [
          "",
          "FIELDS",
          `Show labeled fields the owner recognizes instantly: Name, Phone, Email, Address, all visibly filled but blurred. Plus three to five qualification fields specific to ${v.niche} (for example timeline, budget readiness, property or treatment type, preferred day). The qualification fields stay legible: they are the proof of lead quality.`,
        ].join("\n")
      : "";

  return [
    `You are generating a hyper-realistic marketing image for a sales presentation shown to ${v.niche} business owners.`,
    "",
    `Purpose: show ONE high-quality inquiry arriving in the owner's real world, so the owner looks at it and thinks "I want more of exactly this".`,
    "",
    "The image must feel authentic, emotionally believable and operationally realistic. Nothing staged, nothing corporate, no stock-photo energy.",
    "",
    "SCENE",
    sceneObjective(preset, v.businessName),
    "",
    "THE LEAD, non-negotiable content",
    `- The person inquiring is: ${v.avatar}.`,
    `- Ticket size is implied ONLY through concrete detail: ${v.ticketSignal}. Never show a dollar amount anywhere in the image.`,
    `- The message is first person, motivated, slightly urgent, 60 to 110 words, written in ${v.leadLanguage}. It reads like a real person typing quickly, not marketing copy.`,
    `- It MUST contain this line, near enough to verbatim: "I asked ChatGPT for ${v.avatarQuestion} and ${v.businessName} came up."`,
    v.failedCompetitor
      ? "- The message mentions they tried another company first and either got no answer or were let down. Do not name that other company."
      : "- Do not mention any other company.",
    `- Include readiness signals natural to this trade: a timeline, who decides, and budget or insurance readiness where it fits${where}.`,
    `- Attached: ${v.attachments}, shown as two to four small realistic photo thumbnails.`,
    formFields,
    "",
    "PRIVACY AND REALISM",
    "- Name, phone number, email and street address are present but blurred.",
    "- Photos may be close-crop and non-identifiable. Never a full recognizable face.",
    "- Native, pixel-accurate UI, a believable timestamp, and a 'submitted 2 minutes ago' style marker.",
    "- Natural lighting, shallow depth of field, and correct spelling on every legible word.",
    `- "${v.businessName}" appears exactly as written here. It is the one name that must be perfectly legible.`,
    "",
    "OUTPUT",
    "ONE image, ONE lead. This is shown full screen as the opening of a sales video, so every legible word must be clean and correctly spelled.",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Build the paste-ready dream-lead prompt for this prospect.
 *
 * The avatar is derived from the audit itself rather than asked for: the money questions this
 * business is ABSENT from are, definitionally, the buyers going to someone else, so the dream
 * lead is the person asking the highest-value one of those. Once the niche Intel Brief exists it
 * supplies the pick instead and this becomes the fallback.
 */
export async function buildDreamLeadPrompt(
  report: AuditReportRow,
  view: ReportView,
  presetOverride?: Preset,
  /**
   * The chosen avatar from the niche set (niche-avatars.ts). When present it REPLACES the
   * derivation below — the pick is a decision made against the whole niche's economics, and
   * re-deriving one here would quietly ignore it. The call still runs, to turn that avatar into
   * a ticket signal with no dollar figure and attachments that fit the person.
   */
  avatarHint?: { label: string; ticket: string; aiQuestion: string }
): Promise<DreamLeadResult | DreamLeadRefusal> {
  if (!report.client_name) {
    return {
      ok: false,
      reason:
        "I don't have a confirmed business name on this report, and the business name is the one word in the image that has to be exactly right. Reply `questions` to redo intake with the name, then ask again.",
    };
  }

  const chosen = presetOverride ? { preset: presetOverride, why: "you asked for it" } : choosePreset(report);
  const absent = absentMoneyQuestions(view);

  const { data } = await callClaudeJSON<{
    avatar: string;
    ticket_signal: string;
    avatar_question: string;
    attachments: string;
    failed_competitor: boolean;
  }>({
    model: "claude-sonnet-4-6",
    system: [
      "You design the single dream customer for a local business, for use in a sales image.",
      "You are given the buyer questions this business does NOT appear in. The dream lead is the person asking the highest-value one of those, because that is the buyer currently going to a competitor.",
      "Pick for HIGHEST value and LOWEST effort: recurring contracts beat big one-time jobs, and big one-time jobs beat volume. Never pick a cheap, one-off, price-shopping customer.",
      "",
      "avatar: who they are in one concrete phrase, e.g. 'a property manager with three office plazas' or 'an adult professional, 35 to 55, ready to fix their smile'. Not a demographic, a situation.",
      "ticket_signal: the concrete details that imply a big job WITHOUT any dollar amount. Square footage, number of properties, treatment type, headcount, contract length. Never a price.",
      "avatar_question: the exact phrase this buyer would type into ChatGPT. Lowercase, natural, no quotes. It goes inside the sentence 'I asked ChatGPT for ___ and <business> came up', so it must read grammatically there.",
      "attachments: the photos this specific person would attach, as a short comma list. If they realistically would not attach any, say what a screenshot or document would be instead.",
      "failed_competitor: true only when this trade genuinely involves urgency or a let-down (emergency, restoration, a vendor who missed service). False for routine or elective purchases.",
      "Return JSON only.",
    ].join("\n"),
    user: [
      `Business: ${report.client_name}`,
      `Type: ${report.business_type ?? "unknown"}`,
      `City: ${report.city ?? "not established"}`,
      `Their buyer, as classified: ${report.buyer_persona ?? "unknown"}`,
      "",
      avatarHint
        ? [
            "The avatar is ALREADY CHOSEN. Do not pick a different one.",
            `avatar: ${avatarHint.label}`,
            `what that job is worth: ${avatarHint.ticket}`,
            `avatar_question: ${avatarHint.aiQuestion}`,
            "",
            "Return that same avatar and question back, rewritten only enough to read naturally in the image. Your real job is ticket_signal (the concrete detail implying that value with NO dollar amount) and attachments.",
          ].join("\n")
        : absent.length
          ? `Buyer questions they are ABSENT from (this is where the dream lead comes from):\n${absent.map((q) => `- ${q}`).join("\n")}`
          : "They appear in most tested questions, so pick the highest-value buyer this trade serves.",
      "",
      'Return {"avatar":"...","ticket_signal":"...","avatar_question":"...","attachments":"...","failed_competitor":false}',
    ].join("\n"),
    maxTokens: 700,
    temperature: 0.6,
    validate: (p): p is { avatar: string; ticket_signal: string; avatar_question: string; attachments: string; failed_competitor: boolean } => {
      const o = p as Record<string, unknown>;
      return !!o && typeof o.avatar === "string" && typeof o.ticket_signal === "string" && typeof o.avatar_question === "string";
    },
  });

  const variables: DreamLeadVariables = {
    businessName: report.client_name,
    city: report.city,
    niche: report.business_type ?? "local service",
    avatar: data.avatar.trim(),
    ticketSignal: data.ticket_signal.trim(),
    avatarQuestion: data.avatar_question.trim().replace(/^["']|["']$/g, ""),
    // The LEAD's language, not the owner's: this is the customer writing to them.
    leadLanguage: report.call_language === "es" ? "Español" : "English",
    failedCompetitor: !!data.failed_competitor,
    attachments: (data.attachments || "one photo of the job or space").trim(),
  };

  const prompt = renderPrompt(variables, chosen.preset);

  // Rule 6 is the contract for this feature: a prompt that still contains {SOMETHING} produces
  // an image with a literal placeholder rendered into it.
  const lint = lintDraft({ body: prompt, stage: "package" });
  if (!lint.ok) {
    return { ok: false, reason: `The generated prompt didn't pass the linter: ${lint.findings.map((f) => f.detail).join(" ")}` };
  }

  return { ok: true, preset: chosen.preset, presetWhy: chosen.why, variables, prompt };
}
