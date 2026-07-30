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
//
// ── PRE-PITCH, THEN PITCH (the doctrine that governs cold outreach) ──────────
// A cold prospect never asked for any of this, so there are three stages and
// they must not bleed into each other:
//
//   1. PERMISSION (PERMISSION_SEQUENCE, draftPermissionEmail) — email 1 plus four
//      nudges. Each one carries ONE finding and ONE ask: "mind if I send it over?"
//      No links. No price. No meeting or video ask. The email does not deliver
//      the audit, it earns the right to.
//   2. REVEAL (draftRevealMessage) — fires only once they say yes, in the same
//      thread. THIS is where everything lands at once: report link, scorecard,
//      the free homepage redesign concept, the Loom, the price. If a free
//      redesign was built for this prospect it belongs HERE. It is the reward
//      for saying yes, never the hook that opens the conversation.
//   3. BELIEF (BELIEF_SEQUENCE, draftSequenceEmail, draftObjectionReply) — the
//      original ladder, unchanged. Only sensible after the reveal, because every
//      rung of it assumes they have seen the report.
//
// Why: an email that shows the loss AND links the audit AND links a free
// redesign AND names a price AND asks for 15 minutes makes five asks of a
// stranger and lands in spam. One ask converts. The rest is the payoff.
//
// draftInitialEmail below is the ONE exception and stays a full pitch: it serves
// public free-audit leads who filled out a form and asked for the report. For
// them, sending it is the fulfillment, so there is no permission to earn.

import { callClaudeText, callClaudeJSON } from "@/lib/claude-calls";
import { polishBody } from "./format-guard";
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

// The pre-pitch ladder. Five touches whose ONLY job is a yes to "can I send it
// over?" — nothing here delivers the audit, and nothing here sells. Cadence is
// D0 / D+1 / D+2 / D+4 / D+7, all as replies on the same subject so the thread
// stays one conversation.
export const PERMISSION_SEQUENCE = [
  {
    n: 1,
    day: "D0",
    name: "The gap and the ask",
    job:
      "Open with the single most checkable finding: you asked an AI engine the real question their buyer types, and a competitor came back instead of them. Say you have a screenshot. Then hint (do NOT explain) that you also found one thing on their own site working against them there. Ask permission to send the breakdown, and make clear the scorecard is theirs to keep either way.",
  },
  {
    n: 2,
    day: "D+1",
    name: "Short bump",
    job:
      "Three or four sentences, no new argument. Restate what the breakdown actually shows (which names the engine gives when someone in their market asks, and why theirs is not one of them) and ask again if you should drop it here. This one is deliberately the shortest email in the sequence.",
  },
  {
    n: 3,
    day: "D+2",
    name: "The stakes",
    job:
      "Explain WHY you bothered checking, without any numbers you cannot source. Buyers no longer start on Google, they ask an AI to shortlist for them and then call two or three names. So they get called after the decision is mostly made, if at all. Close by saying the breakdown is ready whenever they want it.",
  },
  {
    n: 4,
    day: "D+4",
    name: "The number, and the absolution",
    job:
      "Lead with one specific finding from the audit, stated flatly. Then absolve them of it immediately and sincerely: it is not a reflection of their work or their years in the trade, it is a signals problem, and signals are fixable. Nobody built their business to be readable by a machine. Say you show exactly why in the breakdown, and to say the word.",
  },
  {
    n: 5,
    day: "D+7",
    name: "The clean exit",
    job:
      "Short, light, a little self-aware ('am I chasing a ghost here?'). Last try. The scorecard is done and theirs free either way, a thumbs up gets it sent, and if it is not for them that is genuinely fine and the emails stop. Give a real out, do not add a new argument.",
  },
];

/**
 * Emails that must not sell. Overrides CTA_RULE and SUBJECT_STYLE for the permission stage.
 *
 * The link rule is conditional, and that exception is deliberate. A REDESIGN link is the
 * finding made tangible: it costs the reader nothing to look at, it proves the work was
 * already done, and it has earned a same-day reply from a cold prospect. A REPORT link is
 * homework we are asking them to do, which is why it stays behind the yes. So: zero links by
 * default, exactly one when a redesign exists, and never both.
 */
function prePitchRules(redesignUrl: string | null): string {
  return [
    "HARD CONSTRAINTS, these override every other instruction about calls to action:",
    redesignUrl
      ? `1. EXACTLY ONE link is allowed in this email, and it is this one: ${redesignUrl}\nThat is the free redesign built for this prospect, and including it is encouraged: it is the finding made tangible, not a pitch. NO OTHER URL may appear. Not the audit report link, not a Loom, not a pricing page, not a calendar link. Two links makes it an advertisement.`
      : "1. NO URLs, links, or attachments of any kind. Not the report link, not a calendar link, nothing. If you catch yourself writing a link, the email is wrong.",
    "2. NO price, no package, no monthly figure, no mention of what the service costs or includes.",
    "3. ONE ASK, and it is the last line. The email ends with a single question they can answer in one word, and that question is permission to send the breakdown. No meeting ask, no call ask, no video ask, no walkthrough, no 5 minute video, no 'worth 15 minutes'. No second CTA of any kind, and this holds even when the redesign link is present. If there are two question marks aimed at the reader, the email is wrong.",
    "4. Exactly ONE finding. Do not list three facts. A stranger who reads two findings reads a pitch.",
    redesignUrl
      ? "5. Under 180 words for the body. The extra room over a linkless email exists ONLY for concrete specifics about what you built them, nothing else."
      : "5. Under 120 words for the body.",
    `6. ${SIGNOFF_RULE}`,
    "The whole email is a door knock, not the pitch. Everything of value is deliberately withheld until they say yes.",
  ].join("\n");
}

/**
 * Paragraph shape. This is the single biggest reason a draft reads like a bot: one sentence
 * per paragraph with a blank line between each. format-guard.ts enforces the mechanical half
 * (capitalization, no emphasis marks) and reflows when this is ignored.
 */
export const PARAGRAPH_RULES = [
  "FORMATTING, this is what separates a human email from a generated one:",
  "Group related sentences into paragraphs of 2 to 4 sentences. A paragraph is a unit of thought, not a line of text. Do NOT put every sentence on its own line with a blank line between them.",
  "At most ONE single-sentence paragraph in the whole email, and only when that sentence earns the emphasis.",
  "Every sentence starts with a capital letter, including the ones that follow a colon.",
  "No bold, no italics, no asterisks, no markdown of any kind. No bullet lists. No headers.",
  "The test: if it would look strange typed by a person in Outlook, it is wrong.",
].join("\n");

/**
 * Who cold outreach is signed by.
 *
 * Not left to the model: it invented "Matthew" on one draft and omitted the sign-off entirely
 * on the next, from the same prompt. The name is stated in the prompt AND appended in code if
 * the model drops it, so every email in a sequence closes the same way. Change these two
 * values if outreach ever goes out under a different name.
 */
export const OUTREACH_SIGNATURE = { name: "Dan", agency: "SRT Agency" };

export const SIGNOFF_RULE = `End with exactly this sign-off, on its own two lines, nothing after it:\n${OUTREACH_SIGNATURE.name}\n${OUTREACH_SIGNATURE.agency}\nNo title, no phone number, no signature block, no postscript.`;

/**
 * Guarantee the sign-off. A cold email that just stops after the question reads like a draft
 * someone forgot to finish, and that is what shipped when the model omitted it.
 */
export function ensureSignoff(body: string): string {
  const trimmed = body.trimEnd();
  const tail = trimmed.slice(-120).toLowerCase();
  if (tail.includes(OUTREACH_SIGNATURE.agency.toLowerCase())) return trimmed;
  return `${trimmed}\n\n${OUTREACH_SIGNATURE.name}\n${OUTREACH_SIGNATURE.agency}`;
}

/** How the sentences themselves sound. Extracted from the reference email below. */
export const VOICE_RULES = [
  "VOICE:",
  "Open with what you did, not who you are. No introduction, no company blurb.",
  "The finding is a number. State it once, without adjectives. Not 'shockingly low', not 'only', just the number.",
  "Name the mechanism concretely. Credibility lives in specifics about THIS business, never in claims about your expertise or your process.",
  "Banned words: game-changer, revolutionary, cutting-edge, unlock, leverage, transform, supercharge, seamless.",
  "No flattery opener. No apologizing for the cold contact, no 'sorry to bother you', no 'I know you're busy'.",
  "Close on a single question the prospect can answer with one word.",
].join("\n");

/**
 * The reference email for permission-stage email 1 WITH a redesign in play. Given to the model
 * as a few-shot to match rhythm and paragraph density, explicitly not wording.
 *
 * Stored with the em dashes of the original normalized to house style, since noDashes() would
 * rewrite them anyway and a few-shot that violates a hard rule teaches the wrong thing.
 *
 * Note what this example DOES do: it explains mechanism. That is allowed, because the mechanism
 * here is concrete and about work already done for them (an FAQ built around the questions
 * engineers ask, certifications marked up, service area named). What stays banned in email 1 is
 * the abstract lecture, "AI engines don't answer from memory, they retrieve and cite 3 to 5
 * names" — that is a seminar, and a stranger did not sign up for it.
 */
export const PERMISSION_EXAMPLE_WITH_REDESIGN = `Raul,

I ran Cellunetics through the AI engines to see what comes back when someone in Miami asks where to get a UL 508A panel built. You came up in 4 of 20 searches. Rather than just send you the bad news, I rebuilt your homepage so you could see the fix next to the problem:

https://www.srtagency.com/preview/cellunetics

Nothing owed, nothing to sign. It's a concept, built from your own work.

The reason it's built the way it is: AI engines pull from pages that answer the questions buyers actually type, in a format a machine can read. Yours has an FAQ section written around the questions engineers ask before they call, your certifications marked up so ChatGPT can cite them, and your service area named where it needs to be.

I also put together the full breakdown of which shops the engines name in Miami instead of you. Want me to send it?

Dan
SRT Agency`;

/** Same rhythm, same closing question, no link. Used when no redesign was built. */
export const PERMISSION_EXAMPLE_NO_REDESIGN = `Raul,

I ran Cellunetics through the AI engines to see what comes back when someone in Miami asks where to get a UL 508A panel built. You came up in 4 of 20 searches, and Custom Controls Technology took most of the rest. I took a screenshot of it.

There's also one thing on your own site working against you there, which is the part most shops never find on their own. It took about a day to put the whole breakdown together.

Want me to send it over? It's yours to keep either way.

Dan
SRT Agency`;

/** The few-shot block, matched to whether a redesign exists for this prospect. */
function permissionExample(redesignUrl: string | null): string {
  return [
    "REFERENCE EMAIL. Match its rhythm, its paragraph density and its restraint. Do NOT reuse its wording, its business, or its details:",
    "---",
    redesignUrl ? PERMISSION_EXAMPLE_WITH_REDESIGN : PERMISSION_EXAMPLE_NO_REDESIGN,
    "---",
  ].join("\n");
}

/** Permission-stage subject lines are the quiet kind: no score, no claim, no bait. */
const PRE_PITCH_SUBJECT_STYLE =
  'Email 1\'s subject is short, lowercase-ish and specific, naming the business and the engine, for example "Cellunetics + ChatGPT". No score, no numbers, no claim, no question mark, no curiosity bait. Every later email in this sequence is a reply on that SAME subject, so prefix it with "re: " and change nothing else.';

function model(): "claude-sonnet-4-6" {
  return "claude-sonnet-4-6";
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function reportContext(report: AuditReportRow, view: ReportView): string {
  const topCompetitors =
    view.mostRecommended
      .slice(0, 3)
      .map((c) => `${c.name} (cited ${c.count}x)`)
      .join(", ") || "no competitor names confidently identified yet";
  const missedExample = view.prompts.find((p) => !p.appeared);
  const absent = view.totalPrompts - view.totalMentioned;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  const name = report.client_name || report.business_type || report.website;
  const signals = (report.site_signals ?? []).map((s) => `- ${s.detail}`).join("\n");
  return [
    `Business: ${name}, a ${report.business_type ?? "unknown category"} (${report.website})${report.city ? ", " + report.city : ""}`,
    report.prospect_name ? `Writing to: ${report.prospect_name}` : "",
    `Buyer persona: ${report.buyer_persona ?? "unknown"}`,
    `AI Visibility Score: ${report.score ?? 0}/100`,
    `ABSENT from ${absent} of ${view.totalPrompts} of the highest-intent buyer questions (appeared in only ${view.totalMentioned}). Frame the ${absent} present tense: those buyer conversations are happening right now without them.`,
    `Names the AI recommends instead: ${topCompetitors}`,
    missedExample ? `Example of a question they are missing: "${missedExample.prompt}"` : "",
    signals
      ? `Things found on their OWN site working against them (verified in their markup, safe to state as fact):\n${signals}`
      : "",
    `Full report link: ${baseUrl}/r/${report.slug}`,
    `Today's date (for the "snapshot dated" line): ${today()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const COMPLIANCE_RULES = [
  // Deliberately says "clients", not "patients". This block is unconditional across every
  // vertical, and a control panel shop reading about patients is an instantly dead deal.
  "NEVER guarantee customers, clients, sales, or revenue. Only visibility and citations, which are verifiable and measured.",
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

// Curated, sourced market facts the sequence emails may cite. Given to the model so it can
// reference the shift WITHOUT inventing.
const UNIVERSAL_MARKET_FACTS = [
  "- The transaction layer: OpenAI added Instant Checkout in ChatGPT (with Stripe) so people can buy directly inside the chat, and is building dedicated retailer experiences inside ChatGPT, with Walmart making roughly 200,000 products available to buy there. In January 2026 Google announced its own agentic-commerce protocol with partners including Walmart, Target and Shopify.",
  "- Roughly 85% of what AI cites about a business comes from third-party sources (reviews, directories, comparison pages), not the business's own website.",
  "- Do NOT transplant the '45% vs 6% of consumers use AI to find local businesses' stat onto online or national businesses. It is specifically about LOCAL business discovery.",
];

const HEALTH_MARKET_FACT =
  "- About 230 million people ask ChatGPT health and wellness questions every week (OpenAI, Jan 2026).";

const HEALTH_VERTICAL_RE = /health|medic|clinic|wellness|dental|derm|therap|hormone|trt|med ?spa|medspa|pharma|doctor|physician|surg|chiro|vet|nurse|psych|recovery|rehab|hospice|fertility|weight loss/i;

/**
 * Market facts for THIS business, with the health stat gated in CODE rather than by a prompt
 * sentence asking nicely.
 *
 * It used to ship unconditionally on the objection path, which is the default branch for any
 * free text in an audit thread. That meant an industrial prospect could be told about the
 * questions people ask ChatGPT about their health, which ends a control-panel deal on the spot.
 * A prose guard ("fits health verticals only") is not a guard.
 */
function marketFactsFor(report: AuditReportRow): string {
  const haystack = `${report.business_type ?? ""} ${report.vertical_slug ?? ""} ${report.buyer_persona ?? ""}`;
  const facts = [...UNIVERSAL_MARKET_FACTS];
  if (HEALTH_VERTICAL_RE.test(haystack)) facts.push(HEALTH_MARKET_FACT);

  return [
    "APPROVED MARKET FACTS (general industry facts, not measured about this specific business). Cite only when they fit the vertical, and never attribute them to the business as if measured on them:",
    ...facts,
    "Do not cite any statistic that is not on this list. In particular, never reach for a statistic from an industry this business is not in.",
  ].join("\n");
}

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
export function noDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/ - /g, ", ");
}

/**
 * How many links a draft is allowed to carry, and which one.
 *
 *   none           permission stage with no redesign built. Zero URLs.
 *   redesign_only  permission stage with a redesign. Exactly that URL, nothing else.
 *   any            reveal and belief stages, where links are the whole point.
 *
 * Enforced as a COUNT rather than a blocklist, so a URL nobody anticipated (a Calendly, a
 * pricing page, a link the model invented) fails the same way the report link does.
 */
export type LinkPolicy =
  | { mode: "none" }
  | { mode: "redesign_only"; url: string }
  | { mode: "any" };

export function linkPolicyFor(report: AuditReportRow): LinkPolicy {
  if (report.outreach_stage === "revealed") return { mode: "any" };
  return report.redesign_url ? { mode: "redesign_only", url: report.redesign_url } : { mode: "none" };
}

const URL_RE = /\b(?:https?:\/\/|\/\/|www\.)[^\s<>()[\]"']+/gi;

/** Loose identity for URL comparison: protocol, www. and trailing slash are all noise here. */
function normalizeUrl(raw: string): string {
  return raw
    .trim()
    .replace(/[.,;:!?)\]]+$/, "") // trailing sentence punctuation the regex swept up
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export interface LinkPolicyResult {
  text: string;
  /** URLs removed because the policy didn't allow them. Surfaced in Slack, never silent. */
  removed: string[];
}

/**
 * Apply a LinkPolicy to a draft. The model is told the rule; this makes it structurally true,
 * the same way noDashes() guarantees the em-dash ban.
 *
 * Only real links are touched (http/https, protocol-relative, www., and Slack's <url|label>
 * form). A bare domain in prose is left alone on purpose: "cellunetics.com" reads naturally in
 * a sentence and is not something a reader clicks out of the email.
 */
export function enforceLinkPolicy(s: string, policy: LinkPolicy): LinkPolicyResult {
  if (policy.mode === "any") return { text: s, removed: [] };

  const allowed = policy.mode === "redesign_only" ? normalizeUrl(policy.url) : null;
  const removed: string[] = [];
  let keptAllowed = false;

  const lines = s
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/gi, "$2") // Slack link markup -> its label
    .split("\n")
    .map((line) => {
      URL_RE.lastIndex = 0;
      if (!URL_RE.test(line)) return line;
      URL_RE.lastIndex = 0;

      const cleaned = line
        .replace(URL_RE, (match) => {
          // Keep the first occurrence of the allowed URL; everything else goes, including a
          // second copy of the allowed one (two links still reads as an advertisement).
          if (allowed && !keptAllowed && normalizeUrl(match) === allowed) {
            keptAllowed = true;
            return match;
          }
          removed.push(match);
          return "";
        })
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([.,!?])/g, "$1")
        .trimEnd();

      // A line whose whole payload WAS a stripped link ("Full audit: <url>") is now a dangling
      // label, so drop it rather than leave a stub in an email Matthew might paste as-is.
      return /^\s*$/.test(cleaned) || /[:\-–—]$/.test(cleaned.trim()) ? null : cleaned;
    })
    .filter((line): line is string => line !== null);

  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Slack warning for a draft that broke its link policy. Null when it was clean. */
export function linkWarning(removed: string[]): string | null {
  if (removed.length === 0) return null;
  const shown = [...new Set(removed.map((u) => normalizeUrl(u)))].slice(0, 3).join(", ");
  return `:warning: Stripped ${removed.length} link${removed.length > 1 ? "s" : ""} that shouldn't be in a pre-pitch email: ${shown}. Check the sentence${removed.length > 1 ? "s" : ""} they were in before sending.`;
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
      belief.n === 3 ? marketFactsFor(report) : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else if (k.kind === "objection") {
    task = [
      "The prospect replied. Draft 3 reply options, each a genuinely different approach that moves the deal forward (not reworded twins).",
      "Belief mechanisms you may draw from:",
      BELIEF_SEQUENCE.map((b) => `${b.n}. ${b.name}: ${b.belief}`).join("\n"),
      marketFactsFor(report),
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
        ? marketFactsFor(report)
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
      marketFactsFor(report),
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

// ── Stage 1: PERMISSION ──────────────────────────────────────────────────────

/** The shared identity + mechanism preamble every permission-stage email opens from. */
const PERMISSION_PERSONA = [
  "You write the cold pre-outreach for SRT Agency LLC ('Scaling Revenue Together'), an AI-search-visibility agency. Matthew personally ran an audit on THIS business before writing, and it shows: every line is specific to them.",
  "Background for YOU, not material to recite: AI engines (ChatGPT, Perplexity, Google AI) do not answer from memory. They search, retrieve a handful of pages, and name 3 to 5 businesses. A business that is not in what gets retrieved is invisible to that buyer no matter how good its work or prices are.",
  "Do NOT explain that mechanism to the reader. A stranger did not sign up for a seminar, and an unsolicited explanation of how AI search works is the fastest way to read as a template. You may only get concrete: name what you found, or name what you built them. Specifics earn the reply, theory does not.",
  "This prospect never asked to hear from you. So the email is NOT the pitch and NOT the delivery. It is a door knock that earns the right to send the breakdown.",
  "Write in the buyer language of THIS business's own industry. Never import vocabulary from another one: a control panel shop has buyers and plant engineers, not patients or clients.",
].join("\n");

/** A permission-stage draft plus what the guards had to do to it, for the Slack footer. */
export interface GuardedDraft extends EmailDraft {
  /** URLs the link policy removed. Empty when the draft obeyed. */
  removedLinks: string[];
  /** Set when the paragraph reflow was attempted and rejected. */
  formatNote: string | null;
}

/**
 * One permission-stage email (step 1 to 5 of PERMISSION_SEQUENCE). One finding, one ask, no
 * price — stated in the prompt and then enforced afterward by the link policy and the format
 * guard, because a model under a word limit drifts back to one-line stanzas and stray links.
 *
 * `intakeAnswers` is Matthew's free-text reply to the intake card, passed through verbatim
 * as instructions that outrank the generic guidance. That is the whole point of the intake:
 * "mention their 2012 site", "don't bring up the score", "his name is Raul, he goes by Raul".
 */
export async function draftPermissionEmail(
  report: AuditReportRow,
  view: ReportView,
  step: number,
  intakeAnswers?: string | null
): Promise<GuardedDraft> {
  const touch = PERMISSION_SEQUENCE.find((t) => t.n === step);
  if (!touch) {
    return {
      subject: "",
      body: `There's no permission email ${step}. The pre-pitch ladder runs 1 to ${PERMISSION_SEQUENCE.length} (try "nudge 2" through "nudge ${PERMISSION_SEQUENCE.length}"). Once they say yes, reply "reveal" and I'll write the message that actually hands everything over.`,
      removedLinks: [],
      formatNote: null,
    };
  }

  // The redesign link is only email 1's to use. A nudge is a bump on a thread they have
  // already seen it in, so re-pasting it there reads like a second pitch.
  const redesignUrl = touch.n === 1 ? report.redesign_url : null;

  const { text } = await callClaudeText({
    model: model(),
    system: [
      PERMISSION_PERSONA,
      `This is touch ${touch.n} of ${PERMISSION_SEQUENCE.length} (${touch.day}), "${touch.name}".`,
      `Its job: ${touch.job}`,
      touch.n > 1
        ? "They have already had the earlier emails and have not replied. Do not restate the whole pitch, do not sound wounded, and do not add a second ask. This is a reply on the same thread."
        : "This is the very first touch. They have never heard of you.",
      prePitchRules(redesignUrl),
      PARAGRAPH_RULES,
      VOICE_RULES,
      PRE_PITCH_SUBJECT_STYLE,
      STYLE_RULES,
      SUBJECT_LINE_INSTRUCTION,
      COMPLIANCE_RULES,
      touch.n === 1 ? permissionExample(redesignUrl) : "",
    ]
      .filter(Boolean)
      .join("\n"),
    user: [
      `Report context (use the real numbers and real competitor names, never invent one):\n${reportContext(report, view)}`,
      intakeAnswers
        ? `\nMatthew's instructions for this outreach. These OUTRANK the generic guidance above, follow them literally:\n"""\n${intakeAnswers}\n"""`
        : "",
      `\nWrite permission email ${touch.n} now.`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 900,
    temperature: 0.6,
  });

  const parsed = parseSubjectAndBody(text);
  const policy: LinkPolicy = redesignUrl ? { mode: "redesign_only", url: redesignUrl } : { mode: "none" };
  const subject = enforceLinkPolicy(noDashes(parsed.subject), { mode: "none" });
  const body = enforceLinkPolicy(noDashes(parsed.body), policy);
  const polished = await polishBody(body.text, { allowEmphasis: false });

  return {
    subject: subject.text,
    body: ensureSignoff(polished.body),
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
  };
}

// ── Stage 2: REVEAL ──────────────────────────────────────────────────────────

/** Default terms when Matthew doesn't pass any with the `reveal` command. */
const DEFAULT_REVEAL_TERMS =
  "$399 per month, month to month, and anything built for them is theirs to keep whether they stay or leave";

/**
 * The message that fires when they say yes. This is the ONLY place in the cold lane where
 * links, the scorecard, the free redesign concept and the price all appear, and they appear
 * together in one message rather than dribbled across a sequence.
 *
 * `terms` is free text from the thread (`reveal $299/mo, setup waived`) because the offer
 * moves per deal and a hardcoded price would quietly go stale.
 */
export async function draftRevealMessage(
  report: AuditReportRow,
  view: ReportView,
  terms?: string | null
): Promise<EmailDraft> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const assets = [
    `The audit report link (include it, framed as where they can see which questions they are missing and who is taking those answers): ${baseUrl}/r/${report.slug}`,
    report.redesign_url
      ? `A homepage redesign concept that was BUILT FOR THEM already, free, nothing owed and nothing to sign. Include this link and frame it as "I didn't want to just hand you a list of problems": ${report.redesign_url}`
      : "No redesign concept was built for this prospect, so do not mention or imply one.",
    report.loom_url
      ? `A short Loom walking through both. Include this link: ${report.loom_url}`
      : "No Loom recorded yet, so do not reference a video.",
  ].join("\n");

  const { text } = await callClaudeText({
    model: model(),
    system: [
      "You write the delivery message for SRT Agency LLC ('Scaling Revenue Together'), an AI-search-visibility agency, at the single best moment in the whole sequence: the prospect just said yes, send it.",
      "Because they asked, this message withholds nothing. It is the one place where the report link, anything built for them, and the price all land at once. Everything before this was a door knock.",
      "Structure: one warm opening line that delivers on the promise, then each asset with one sentence of framing, then the offer in plain terms, then a single low-friction next step (a one-word reply). Do NOT re-argue the gap. They already agreed to look. Re-selling here is the mistake.",
      "The free work is a gift with no strings, and it must read that way. Say plainly that there is nothing to sign and nothing owed. Never imply the offer is contingent on them taking it.",
      "Under 200 words. Plain text ready to paste. Keep the same subject thread they replied on, so the subject line is a 're: ' of the original.",
      "Never guarantee customers, revenue or rankings. Only visibility and citations, which are measured.",
      PARAGRAPH_RULES,
      "One exception to the formatting rules above, and only one: the price line may be bold. Nothing else in the email may be.",
      VOICE_RULES,
      STYLE_RULES,
      SUBJECT_LINE_INSTRUCTION,
      COMPLIANCE_RULES,
    ].join("\n"),
    user: [
      `Report context:\n${reportContext(report, view)}`,
      `\nWhat you are handing over:\n${assets}`,
      `\nThe offer, state it in these terms and invent nothing beyond them:\n${terms?.trim() || DEFAULT_REVEAL_TERMS}`,
      `\nWrite the reveal message now.`,
    ].join("\n"),
    maxTokens: 900,
    temperature: 0.6,
  });

  const parsed = parseSubjectAndBody(text);
  const polished = await polishBody(noDashes(parsed.body), { allowEmphasis: true });
  return { subject: noDashes(parsed.subject), body: ensureSignoff(polished.body) };
}
