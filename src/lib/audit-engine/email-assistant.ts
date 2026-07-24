// Threaded email-drafting assistant for closed audit reports. Grounded in SRT's
// own sales SOP (the-gap mechanism, the 4-layer product, risk-reversal, honest
// urgency) and generalized beyond the original TRT-only letter so it works for
// any vertical this engine audits.
//
// Positioning constraint: SRT's whole brand is anti-snake-oil, so we NEVER
// manufacture urgency. We only surface urgency that is already true and that the
// prospect could verify themselves. Each email installs ONE belief, never a
// stacked pile of scarcity. Every draft is posted to Slack for Matthew to
// review/edit — this module never sends anything to a customer itself.

import { callClaudeText, callClaudeJSON } from "@/lib/claude-calls";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

// One mechanism per email. Email 1 is a cold first touch and deliberately gets
// only the present-tense reframe (stacking scarcity on a first email reads
// desperate). Later emails each add exactly one honest urgency mechanism.
export const BELIEF_SEQUENCE = [
  {
    n: 1,
    name: "The Gap (present-tense loss)",
    belief:
      "Your absence is not a future risk. Right now most of the highest-intent buyer questions in your category are being answered without you, in every buyer conversation happening this week, and the competitors already in those answers compound each month.",
  },
  {
    n: 2,
    name: "Competitor compounding",
    belief:
      "The names already cited get harder to displace every month: engines keep re-reading the same third-party sources that cite the incumbent, so their position reinforces itself. Claiming open ground is a 60 to 90 day project. Unseating an entrenched competitor later is a much longer one.",
  },
  {
    n: 3,
    name: "The transaction layer",
    belief:
      "The same retailers beating you in the recommendation layer are being wired into the transaction layer, where AI assistants let people buy inside the chat, not just recommend. When the answer becomes the shelf, being absent stops being a marketing problem and becomes a distribution one.",
  },
  {
    n: 4,
    name: "Category exclusivity",
    belief:
      "SRT takes one business per category, because nobody can honestly build two competitors toward the same answers. The first signed engagement claims the category. That is arithmetic, not a countdown.",
  },
  {
    n: 5,
    name: "The archive close",
    belief:
      "The audit is a dated snapshot and goes stale as answers drift, so it gets archived rather than kept live. If AI visibility is not a priority this quarter that is completely fair, and this is the last note either way.",
  },
];

function model(): "claude-sonnet-4-6" {
  return "claude-sonnet-4-6";
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function reportContext(report: AuditReportRow, view: ReportView): string {
  const topCompetitors =
    view.mostRecommended
      .slice(0, 3)
      .map((c) => `${c.name} (cited ${c.count}x)`)
      .join(", ") || "no competitor names confidently identified yet";
  const missedExample = view.prompts.find((p) => !p.appeared);
  const absent = view.totalPrompts - view.totalMentioned;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  const name = report.client_name || report.business_type || report.website;
  return [
    `Business: ${name}, a ${report.business_type ?? "unknown category"} (${report.website})${report.city ? ", " + report.city : ""}`,
    `Buyer persona: ${report.buyer_persona ?? "unknown"}`,
    `AI Visibility Score: ${report.score ?? 0}/100`,
    `ABSENT from ${absent} of ${view.totalPrompts} of the highest-intent buyer questions (appeared in only ${view.totalMentioned}). Frame the ${absent} present tense: those buyer conversations are happening right now without them.`,
    `Names the AI recommends instead: ${topCompetitors}`,
    missedExample ? `Example of a question they are missing: "${missedExample.prompt}"` : "",
    `Full report link: ${baseUrl}/r/${report.slug}`,
    `Today's date (for the "snapshot dated" line): ${today()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const COMPLIANCE_RULES = [
  "NEVER guarantee customers, patients, sales, or revenue. Only visibility and citations, which are verifiable and measured.",
  "NEVER invent a stat, screenshot, or competitor name that is not in the context given (the report context, or the approved market facts when provided).",
  "No medical or regulated-industry outcome claims of any kind.",
  "Month-to-month framing. Never imply a long-term contract or lock-in.",
  "Never imply a competitor is talking to us or considering us unless that is literally stated. That is the classic sleaze move and it is checkable.",
].join("\n");

// Style rules that make the drafts read human and on-brand. The em-dash ban is
// the single highest-impact one: em dashes are the #1 AI-generated tell.
const STYLE_RULES = [
  "Do NOT use em dashes (—) or en dashes (–) anywhere, and never use ' - ' as a sentence connector. Use periods and commas, or restructure. Write numeric ranges with 'to' (for example '3 to 5', not '3-5'). This rule is non-negotiable: em dashes make it read AI-generated and that kills the brand.",
  "Write like the specific person who personally ran this audit on THIS business, not a template. Vary sentence length. No 'I hope this finds you well', no corporate filler, no bullet lists unless they genuinely earn their place.",
  "Surface urgency that is already true in the data. Never manufacture it: no countdowns, no fake 'spots left', no expiring discounts. The prospect has been burned by exactly those tricks and will catch them.",
].join("\n");

// Curated, sourced market facts the sequence emails may cite when they fit the
// vertical. Given to the model so it can reference the shift WITHOUT inventing.
const APPROVED_MARKET_FACTS = [
  "APPROVED MARKET FACTS (general industry facts, not measured about this specific business). Cite only when they fit the vertical, and never attribute them to the business as if measured on them:",
  "- The transaction layer: OpenAI added Instant Checkout in ChatGPT (with Stripe) so people can buy directly inside the chat, and is building dedicated retailer experiences inside ChatGPT, with Walmart making roughly 200,000 products available to buy there. In January 2026 Google announced its own agentic-commerce protocol with partners including Walmart, Target and Shopify.",
  "- Roughly 85% of what AI cites about a business comes from third-party sources (reviews, directories, comparison pages), not the business's own website.",
  "- About 230 million people ask ChatGPT health and wellness questions every week (OpenAI, Jan 2026). Fits health, medical-supply and wellness verticals only.",
  "- Do NOT transplant the '45% vs 6% of consumers use AI to find local businesses' stat onto online or national businesses. It is specifically about LOCAL business discovery.",
].join("\n");

const SUBJECT_LINE_INSTRUCTION =
  "Output format: first line is exactly `Subject: <the subject line>`, then one blank line, then the email body. Nothing before the Subject line, no markdown. The subject line itself must also contain no em dashes.";

// The one fixed close for every email. Matthew's call: a low-friction 5-minute video, never
// a 20-minute call. Kept verbatim so no draft drifts back to the old "walkthrough call" ask.
const CTA_LINE =
  "Happy to walk you through it in a 5 min video, no commitment, just data and action plan.";
const CTA_RULE = `Close EVERY email with this exact call to action as its final line before the sign-off (verbatim, or a light paraphrase that keeps all of it): "${CTA_LINE}" Never offer a 20 minute call or a phone walkthrough. A one-line "reply and I'll send it" invite may precede it. Then a plain one-line close, no full signature block.`;

// Subject-line direction. The score line is the preferred pattern (Matthew's favorite).
const SUBJECT_STYLE =
  'Subject lines lead with the specific finding, not curiosity bait. Preferred patterns: the score line, e.g. "{Business} scored {score}/100 on AI visibility", or the competitor line, e.g. "{Competitor} is in the answers {Business} is missing". Use their real score and real competitor names from the context. Human and specific, no clickbait, no em dashes.';

export interface EmailDraft {
  subject: string;
  body: string;
}

/** Splits "Subject: X\n\nbody..." into {subject, body}. Falls back gracefully if the model didn't follow the format. */
function parseSubjectAndBody(text: string): EmailDraft {
  const match = text.match(/^Subject:\s*(.+?)\r?\n\r?\n([\s\S]*)$/i);
  if (match) return { subject: match[1].trim(), body: match[2].trim() };
  return { subject: "", body: text.trim() };
}

export async function draftInitialEmail(report: AuditReportRow, view: ReportView): Promise<EmailDraft> {
  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write EMAIL 1 of SRT Agency LLC's AI-visibility outreach. SRT ('Scaling Revenue Together') is an AI-search-visibility agency.",
      "Mechanism: AI engines (ChatGPT, Perplexity, Google AI) do not answer from memory. They search, retrieve a handful of pages, and cite 3 to 5 names. If a business is not in what gets retrieved, that buyer never sees it, no matter how good its site or prices are.",
      "This is a cold first touch. Install exactly ONE belief: present-tense loss. Do not stack scarcity or pile on outside facts. A first email that stacks reads desperate.",
      "Lead by reframing the audit result as an ongoing bleed, present tense, using their OWN real numbers. For example: 'Right now, X of the 20 highest-intent questions in your category get answered without {business} in them. That is not a future risk. It is the state of every buyer conversation happening this week.' Use the real absent-count and the real competitor names that show up instead, with their citation counts if given.",
      "Then open a curiosity gap: the full report shows exactly which questions they are missing and which of their own pages need to become the quotable answer. The only way to see it is the link or a reply.",
      "Include the report link framed as a dated snapshot ('answers drift week to week') using today's date given below. Do NOT claim the link expires.",
      "Under 180 words for the body. Plain text ready to paste.",
      CTA_RULE,
      SUBJECT_STYLE,
      STYLE_RULES,
      SUBJECT_LINE_INSTRUCTION,
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nWrite email 1 now.`,
    maxTokens: 700,
    temperature: 0.6,
  });
  return parseSubjectAndBody(text);
}

// One choose-from option: a short angle label + a full email. Stored on the report row so a
// "1/2/3" thread reply can turn the chosen one into an Outlook draft.
export interface EmailOption {
  label: string;
  subject: string;
  body: string;
}

// Belt-and-suspenders dash strip (the model is already told, but this guarantees it). Turns
// em/en dashes and " - " connectors into commas; leaves hyphenated words and 3-5 style intact.
function noDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/ - /g, ", ");
}

// The three cold-email archetypes Matthew picks between (matches the A/B/C he likes).
const INITIAL_ARCHETYPES = [
  '1. "Show the loss": lead with present-tense absence using their real numbers (X of 20 highest-intent questions are answered without them right now, every buyer conversation this week).',
  '2. "Verification first": invite them to check it themselves in one minute from a logged-out browser (ask the AI the real buyer question, see who comes back). Their own neutral-account result is the proof, not our claim.',
  '3. "Competitor urgency": name one specific competitor already cited, explain it compounds (the engines keep re-reading the same third-party sources that cite the incumbent), and contrast the timing: claiming open questions is a 60 to 90 day project, displacing an entrenched name later is a much longer one.',
];

export type DraftKind =
  | { kind: "initial" }
  | { kind: "sequence"; step: number }
  | { kind: "objection"; prospectSaid: string };

/**
 * Draft EXACTLY 3 labeled email options for the prospect to choose between. The initial and
 * objection kinds use the three archetypes (loss / verification / competitor-urgency); a
 * sequence step returns 3 executions of that step's single belief. Every option obeys the
 * fixed 5-minute-video CTA, the score/competitor subject style, and the no-dashes rule.
 */
export async function draftEmailOptions(report: AuditReportRow, view: ReportView, k: DraftKind): Promise<EmailOption[]> {
  let task: string;
  if (k.kind === "sequence") {
    const belief = BELIEF_SEQUENCE.find((b) => b.n === k.step);
    if (!belief) throw new Error(`there's no email ${k.step} in the sequence (it goes up to ${BELIEF_SEQUENCE.length})`);
    task = [
      `Draft EMAIL ${belief.n}, "${belief.name}", for a prospect who already saw email 1.`,
      `Every option installs this ONE belief: ${belief.belief}`,
      "Give 3 options that install that same belief through different angles and subject lines. Where it fits, make at least one option lead with the competitor-urgency framing. Do not re-stack the other emails' angles.",
      belief.n === 3 ? APPROVED_MARKET_FACTS : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else if (k.kind === "objection") {
    task = [
      "The prospect replied. Draft 3 reply options, each a genuinely different approach that moves the deal forward (not reworded twins).",
      "Belief mechanisms you may draw from:",
      BELIEF_SEQUENCE.map((b) => `${b.n}. ${b.name}: ${b.belief}`).join("\n"),
      APPROVED_MARKET_FACTS,
      `The prospect said:\n"${k.prospectSaid}"`,
    ].join("\n");
  } else {
    task = [
      "This is the first cold outreach touch. Draft 3 complete cold emails: same audit facts, three different angles, one belief each (do not stack angles inside one option):",
      ...INITIAL_ARCHETYPES,
      "Include the dated report link in each option.",
    ].join("\n");
  }

  const { data } = await callClaudeJSON<{ options: EmailOption[] }>({
    model: model(),
    system: [
      "You write cold outreach and reply emails for SRT Agency LLC's AI-visibility audit offer. SRT ('Scaling Revenue Together') is an AI-search-visibility agency. AI engines (ChatGPT, Perplexity, Google AI) do not answer from memory: they retrieve a few pages and cite 3 to 5 names. A business not in what gets retrieved is invisible to that buyer no matter how good its site or prices.",
      "Write as the specific person who personally ran this audit on THIS business, not a template.",
      "Return EXACTLY 3 options. Each option has a short 2 to 4 word angle label, a subject line, and a plain-text body ready to paste. The 3 must be genuinely different angles.",
      task,
      "Each body under 180 words. Use the business's own real audit numbers below.",
      CTA_RULE,
      SUBJECT_STYLE,
      STYLE_RULES,
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nReturn the 3 options as JSON.`,
    maxTokens: 3000,
    temperature: 0.7,
    schemaHint: '{ "options": [{ "label": string, "subject": string, "body": string }] }',
    validate: (v: unknown): v is { options: EmailOption[] } =>
      typeof v === "object" &&
      v !== null &&
      Array.isArray((v as { options?: unknown }).options) &&
      (v as { options: unknown[] }).options.length > 0 &&
      (v as { options: EmailOption[] }).options.every(
        (o) => o && typeof o.label === "string" && typeof o.subject === "string" && typeof o.body === "string"
      ),
  });

  return data.options.slice(0, 3).map((o) => ({
    label: noDashes(o.label).trim(),
    subject: noDashes(o.subject).trim(),
    body: noDashes(o.body).trim(),
  }));
}

export async function draftSequenceEmail(report: AuditReportRow, view: ReportView, step: number): Promise<EmailDraft> {
  const belief = BELIEF_SEQUENCE.find((b) => b.n === step);
  if (!belief) {
    return {
      subject: "",
      body: `There's no email ${step} in the sequence — it only goes up to ${BELIEF_SEQUENCE.length}. Try "email 2" through "email ${BELIEF_SEQUENCE.length}", or just paste what the prospect said back and I'll draft a reply to that instead.`,
    };
  }

  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write follow-up emails continuing SRT Agency LLC's AI-visibility audit sequence to a prospect who has already seen email 1.",
      `This is EMAIL ${belief.n}, "${belief.name}". Its ONE job is to install this belief in the reader: ${belief.belief}`,
      "Install only this one mechanism. Do not re-stack the earlier emails' angles. You may add at most one genuinely new finding from the report if it strengthens the point.",
      "Use the business's own real audit numbers below wherever they strengthen the point. Keep the voice of the founder who ran the research personally on THIS business.",
      belief.n === 3
        ? APPROVED_MARKET_FACTS
        : "You generally rely on the business's own audit data below; only reach for outside facts if clearly appropriate for this vertical.",
      "Under 170 words for the body. Plain text ready to paste.",
      CTA_RULE,
      SUBJECT_STYLE,
      STYLE_RULES,
      SUBJECT_LINE_INSTRUCTION,
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nWrite email ${belief.n} now.`,
    maxTokens: 700,
    temperature: 0.6,
  });
  return parseSubjectAndBody(text);
}

export async function draftObjectionReply(report: AuditReportRow, view: ReportView, prospectSaid: string): Promise<EmailDraft> {
  const sequenceSummary = BELIEF_SEQUENCE.map((b) => `${b.n}. ${b.name} — ${b.belief}`).join("\n");

  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write reply emails for SRT Agency LLC's AI-visibility audit offer. Matthew (the founder) pastes what a prospect actually said; you draft the reply that best moves the deal forward.",
      "The belief mechanisms available to draw from (pick whichever fits the objection, not necessarily in order):",
      sequenceSummary,
      APPROVED_MARKET_FACTS,
      "Use the business's own real audit numbers below wherever relevant. Match the tone of someone who already did specific research on THIS business, not a canned rebuttal.",
      "Under 170 words for the body. Plain text ready to paste.",
      CTA_RULE,
      SUBJECT_STYLE,
      STYLE_RULES,
      SUBJECT_LINE_INSTRUCTION,
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nThe prospect said:\n"${prospectSaid}"\n\nDraft the reply now.`,
    maxTokens: 700,
    temperature: 0.6,
  });
  return parseSubjectAndBody(text);
}
