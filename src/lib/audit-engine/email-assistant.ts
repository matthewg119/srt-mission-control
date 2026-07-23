// Threaded email-drafting assistant for closed audit reports. Grounded in SRT's
// own sales SOP (the-gap mechanism, the 4-layer product, risk-reversal, ROI
// framing, founding-rate urgency — see Desktop/AEO aduit/SRT_Audit_SOP_Universal.md
// and SRT_Sales_Letter.md), generalized beyond the original TRT-only sales
// letter so it works for any vertical this engine audits.
//
// Every draft is posted to Slack for Matthew to review/edit — this module never
// sends anything to a customer itself.

import { callClaudeText } from "@/lib/claude-calls";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

export const BELIEF_SEQUENCE = [
  { n: 1, name: "The Gap", belief: "You are missing from the exact answers your buyers are already asking an AI for." },
  {
    n: 2,
    name: "Why this isn't more agency noise",
    belief:
      "This isn't SEO reheated or generic AI blog spam — it's a specific, measurable mechanism (entity clarity, answer-first content, third-party citation sources — about 85% of what AI quotes comes from off-site sources, not your own website) that most agencies skip.",
  },
  {
    n: 3,
    name: "Risk reversal",
    belief:
      "Month-to-month, you keep everything (schema, content, profiles, data) if you ever leave, and the only guarantee is on visibility/citations — never on customers or revenue, because anyone promising that is lying.",
  },
  {
    n: 4,
    name: "The math",
    belief: "One additional customer/order/patient a year from being the AI-recommended option pays for this many times over.",
  },
  {
    n: 5,
    name: "Close",
    belief:
      "The founding-rate window is real and closing — the business that claims the AI answer in their category owns it the way page-one Google was owned a decade ago. Right now the spot is empty.",
  },
];

function model(): "claude-sonnet-4-6" {
  return "claude-sonnet-4-6";
}

function reportContext(report: AuditReportRow, view: ReportView): string {
  const topCompetitors =
    view.mostRecommended
      .slice(0, 3)
      .map((c) => `${c.name} (cited ${c.count}x)`)
      .join(", ") || "no competitor names confidently identified yet";
  const missedExample = view.prompts.find((p) => !p.appeared);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  return [
    `Business: ${report.business_type ?? report.website} (${report.website})${report.city ? ", " + report.city : ""}`,
    `Buyer persona: ${report.buyer_persona ?? "unknown"}`,
    `AI Visibility Score: ${report.score ?? 0}/100 — appeared in ${view.totalMentioned} of ${view.totalPrompts} real buyer questions`,
    `Names the AI recommends instead: ${topCompetitors}`,
    missedExample ? `Example of a missed question: "${missedExample.prompt}"` : "",
    `Full report (send this link): ${baseUrl}/r/${report.slug}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const COMPLIANCE_RULES = [
  "NEVER guarantee customers, patients, sales, or revenue — only visibility and citations, which are verifiable and measured.",
  "NEVER invent a stat, screenshot, or competitor name that isn't in the report context given below.",
  "No medical or regulated-industry outcome claims of any kind.",
  "Month-to-month framing — never imply a long-term contract or lock-in.",
].join("\n");

export async function draftInitialEmail(report: AuditReportRow, view: ReportView): Promise<string> {
  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write cold outreach emails for SRT Agency LLC ('Scaling Revenue Together'), an AI-search-visibility agency.",
      "The mechanism: AI engines (ChatGPT, Perplexity, Google AI) don't answer from memory — they search, retrieve a handful of pages, and synthesize an answer citing 3-5 names. If a business isn't in what gets retrieved, or its own pages aren't written to be the quotable answer, it's invisible to that buyer — even with a great website.",
      "Write EMAIL 1 of a sequence: 'The Gap'. Short, direct, uses the business's OWN real audit numbers below (never invented). Tone: a peer pointing out something urgent and fixable, not a salesperson pitching.",
      "Structure: open with the specific gap (their score, what showed up instead of them), 2-3 sentences on why this matters now, soft CTA to reply or book a call to walk through the full report (link included).",
      "Under 200 words. Plain text ready to paste into an email client — no markdown formatting, no subject line unless asked for one.",
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nWrite the email now.`,
    maxTokens: 700,
    temperature: 0.6,
  });
  return text;
}

export async function draftSequenceEmail(report: AuditReportRow, view: ReportView, step: number): Promise<string> {
  const belief = BELIEF_SEQUENCE.find((b) => b.n === step);
  if (!belief) {
    return `There's no email ${step} in the sequence — it only goes up to ${BELIEF_SEQUENCE.length}. Try "email 2" through "email ${BELIEF_SEQUENCE.length}", or just paste what the prospect said back and I'll draft a reply to that instead.`;
  }

  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write follow-up emails continuing SRT Agency LLC's AI-visibility audit outreach sequence.",
      `This is EMAIL ${belief.n} — "${belief.name}". Its job is to install this belief in the reader: ${belief.belief}`,
      "Use the business's own real audit numbers below wherever it strengthens the point (never invent facts not given). Keep the voice of a founder who did the research personally on THIS business, not a generic template.",
      "Under 180 words. Plain text ready to paste into an email client. No subject line unless asked.",
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nWrite email ${belief.n} now.`,
    maxTokens: 700,
    temperature: 0.6,
  });
  return text;
}

export async function draftObjectionReply(report: AuditReportRow, view: ReportView, prospectSaid: string): Promise<string> {
  const sequenceSummary = BELIEF_SEQUENCE.map((b) => `${b.n}. ${b.name} — ${b.belief}`).join("\n");

  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write reply emails for SRT Agency LLC's AI-visibility audit offer. Matthew (the founder) pastes what a prospect actually said; you draft the reply that best moves the deal forward.",
      "The belief sequence available to draw from — pick whichever fits the objection, not necessarily in numeric order:",
      sequenceSummary,
      "Use the business's own real audit numbers below wherever relevant (never invent facts not given). Match the tone of someone who already did specific research on THIS business, not a generic canned rebuttal.",
      "Under 180 words. Plain text ready to paste into an email client.",
      COMPLIANCE_RULES,
    ].join("\n"),
    user: `Report context:\n${reportContext(report, view)}\n\nThe prospect said:\n"${prospectSaid}"\n\nDraft the reply now.`,
    maxTokens: 700,
    temperature: 0.6,
  });
  return text;
}
