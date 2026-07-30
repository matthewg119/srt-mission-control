// The intake step between "audit finished" and "email 1 written".
//
// Before this existed, a finished audit dumped 3 finished cold emails into the Slack thread
// and there was no way to tell the bot anything first — not even who the recipient is (a cold
// /audit run has no contact row, so the Outlook draft went out with an empty To). The drafts
// were also written blind: they couldn't know Matthew had already built the prospect a free
// homepage redesign, or that the real hook was something he'd spotted himself.
//
// So: report done -> the bot ASKS (four fixed slots plus one or two questions drawn from this
// specific audit) -> Matthew answers in free text in the thread -> ONE finished email 1 comes
// back under the permission doctrine in email-assistant.ts (no links, no price, one finding).
//
// The four fixed slots are hardcoded rather than model-generated on purpose: the recipient's
// name and address are what make the Outlook draft sendable, and a generated question set that
// happened to omit them would break the last step of the flow.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { callClaudeJSON } from "@/lib/claude-calls";
import {
  reportContext,
  noDashes,
  enforceLinkPolicy,
  linkPolicyFor,
  PERMISSION_SEQUENCE,
  PARAGRAPH_RULES,
  VOICE_RULES,
  PERMISSION_EXAMPLE_WITH_REDESIGN,
  PERMISSION_EXAMPLE_NO_REDESIGN,
  type EmailOption,
  type LinkPolicy,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

const MODEL = "claude-sonnet-4-6" as const;

export interface IntakeQuestion {
  n: number;
  ask: string;
  /** "fixed" = always asked. "audit" = generated from this report's findings. */
  source: "fixed" | "audit";
}

// Always asked, in this order. Slots 1 and 2 feed the Outlook draft; 3 is the "just in case we
// want to mention anything in particular" slot; 4 exists because the free redesign changes the
// email (it becomes a hint at "one thing on your site working against you") and because its
// link must be held back for the reveal.
const FIXED_QUESTIONS: string[] = [
  "Who am I writing to? First name and their role.",
  "Their email address, so I can build the Outlook draft.",
  "Anything specific you want mentioned, or kept out?",
  'Free redesign in play for this one? Paste the link if it\'s live, or say "building it" and I\'ll keep it for the reveal.',
];

/** How many audit-specific questions to ask on top of the fixed four. */
const AUDIT_QUESTION_TARGET = 2;

/**
 * The four fixed slots plus one or two questions written from THIS report's findings.
 *
 * The generated ones are what make the card feel like the bot actually read the audit: it
 * offers the hook it found ("ChatGPT can't confirm they're a real company, use that as email
 * 1's one finding, or save it for nudge 4?") instead of asking Matthew to go look. A model
 * failure here is not fatal — the fixed four alone are enough to write email 1.
 */
export async function buildIntakeQuestions(
  report: AuditReportRow,
  view: ReportView
): Promise<IntakeQuestion[]> {
  const questions: IntakeQuestion[] = FIXED_QUESTIONS.map((ask, i) => ({
    n: i + 1,
    ask,
    source: "fixed" as const,
  }));

  try {
    const { data } = await callClaudeJSON<{ questions: string[] }>({
      model: MODEL,
      system: [
        "You are prepping a cold outreach email for SRT Agency LLC, an AI-search-visibility agency. An audit just finished on a prospect's business. Before the email gets written, you ask the founder the few things that only he can decide.",
        `Write exactly ${AUDIT_QUESTION_TARGET} questions, drawn from THIS audit's actual findings below. Nothing generic: each question must name a real number, a real competitor, or a real thing found on their site.`,
        "The email being written is a cold PRE-PITCH: it carries exactly ONE finding, no links, no price, and its only ask is permission to send the breakdown. So the most useful question is almost always which single finding leads, and what gets held back for a later nudge.",
        "Each question is one line, conversational, answerable in a few words. Offer the concrete option you'd pick, so it can be answered with a yes.",
        "Do NOT ask for the recipient's name, their email address, whether a redesign exists, or anything about tone or length. Those are already covered.",
        "Do not use em dashes or en dashes anywhere.",
      ].join("\n"),
      user: `Audit findings:\n${reportContext(report, view)}\n\nReturn the questions as JSON.`,
      maxTokens: 700,
      temperature: 0.5,
      schemaHint: '{ "questions": [string] }',
      validate: (v: unknown): v is { questions: string[] } =>
        typeof v === "object" &&
        v !== null &&
        Array.isArray((v as { questions?: unknown }).questions) &&
        (v as { questions: unknown[] }).questions.every((q) => typeof q === "string" && q.trim().length > 0),
    });

    data.questions.slice(0, AUDIT_QUESTION_TARGET).forEach((ask) => {
      questions.push({ n: questions.length + 1, ask: noDashes(ask).trim(), source: "audit" });
    });
  } catch (e) {
    // The fixed four still produce a usable email 1, so a generation failure degrades the
    // card instead of blocking the outreach.
    console.error("[outreach-intake] audit-specific questions failed:", (e as Error).message);
  }

  return questions;
}

function displayName(report: AuditReportRow): string {
  return report.client_name || report.business_type || report.website;
}

/** Persist the questions, flip the thread into awaiting_intake, and post the card. */
export async function postIntakeCard(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  questions: IntakeQuestion[]
): Promise<void> {
  await supabaseAdmin
    .from("audit_reports")
    .update({ intake_questions: questions, outreach_stage: "awaiting_intake" })
    .eq("id", report.id);

  const fixed = questions.filter((q) => q.source === "fixed");
  const fromAudit = questions.filter((q) => q.source === "audit");

  const lines = [
    `:brain: Before I write email 1 for *${displayName(report)}*, a few things:`,
    "",
    ...fixed.map((q) => `${q.n}. ${q.ask}`),
  ];

  if (fromAudit.length > 0) {
    lines.push("", fromAudit.length === 1 ? "_One I noticed:_" : "_A couple I noticed:_");
    lines.push(...fromAudit.map((q) => `${q.n}. ${q.ask}`));
  }

  lines.push(
    "",
    "_Reply in this thread however you want, numbered or not. I'll write one finished draft from your answers, then *1* creates the Outlook draft._"
  );

  await slack.postThreadReply(channel, threadTs, lines.join("\n"));
}

function questionBlock(report: AuditReportRow): string {
  const questions = (report.intake_questions ?? []) as IntakeQuestion[];
  if (questions.length === 0) return "(the questions weren't recorded, read the answers on their own)";
  return questions.map((q) => `${q.n}. ${q.ask}`).join("\n");
}

/** What draftFromIntake pulled out of the free-text answer, for storing on the report row. */
export interface IntakeExtraction {
  prospect_name: string | null;
  prospect_email: string | null;
  redesign_url: string | null;
}

export interface IntakeDraftResult {
  draft: EmailOption;
  extracted: IntakeExtraction;
  /** URLs the link policy removed, for the Slack warning. Empty when the draft obeyed. */
  removedLinks: string[];
  /** Set when the paragraph reflow was attempted and rejected. */
  formatNote: string | null;
}

/**
 * First URL in Matthew's intake answers.
 *
 * Needed because the redesign link usually arrives IN the answers ("4. yes, https://...") and
 * is not on the report row yet at drafting time. Without this the very first draft would be
 * held to the zero-link policy and would strip the link he just handed over.
 */
function redesignFromAnswers(answers: string): string | null {
  const m = answers.match(/\b(?:https?:\/\/|www\.)[^\s<>()[\]"']+/i);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]]+$/, "");
  return url.startsWith("http") ? url : `https://${url}`;
}

const PROSPECT_FIELDS_INSTRUCTION = [
  "Alongside the email, pull these out of the answers so the Outlook draft can be addressed. Use null for anything genuinely absent, never a guess:",
  '- prospect_name: the recipient\'s first name only, as you would greet them ("Raul", or "Dr. Mehta" when a doctor title is given).',
  "- prospect_email: their email address, exactly as written.",
  "- redesign_url: the URL of the free redesign concept, ONLY if an actual link was given. \"building it\" or \"not yet\" means null.",
].join("\n");

/**
 * Shared no-sell constraints for the intake drafter, kept in sync with prePitchRules().
 *
 * The link rule is conditional on whether a redesign exists for this prospect: a redesign link
 * is the finding made tangible and is allowed as the email's ONE link, while the report link
 * stays behind the yes because it is homework we would be asking them to do.
 */
function intakeDraftSystem(redesignUrl: string | null): string {
  return [
    "You write the cold pre-outreach for SRT Agency LLC ('Scaling Revenue Together'), an AI-search-visibility agency. Matthew personally ran an audit on THIS business before writing, and it shows: every line is specific to them.",
    "Background for YOU, not material to recite: AI engines (ChatGPT, Perplexity, Google AI) do not answer from memory. They search, retrieve a handful of pages, and name 3 to 5 businesses. A business that is not in what gets retrieved is invisible to that buyer no matter how good its work or prices are.",
    "Do NOT explain that mechanism to the reader. A stranger did not sign up for a seminar. You may only get concrete: name what you found, or name what you built them. Specifics earn the reply, theory does not.",
    "Write in the buyer language of THIS business's own industry. Never import vocabulary from another one: a control panel shop has buyers and plant engineers, not patients or clients.",
    `You are writing EMAIL 1, "${PERMISSION_SEQUENCE[0].name}". Its job: ${PERMISSION_SEQUENCE[0].job}`,
    "HARD CONSTRAINTS, these override everything else:",
    redesignUrl
      ? `1. EXACTLY ONE link is allowed, and it is this one: ${redesignUrl}\nThat is the free redesign built for this prospect. Including it is encouraged: it is the finding made tangible, and it costs the reader nothing to look at. NO OTHER URL may appear. Not the audit report link, not a Loom, not a pricing page, not a calendar link. Two links makes it an advertisement.`
      : "1. NO URLs or links of any kind. Not the report link, not a calendar link, nothing. If a redesign is being built but is not live yet, hint that you found something on their site working against them and hold everything else back.",
    "2. NO price, no package, no monthly figure.",
    "3. ONE ASK, and it is the last line: a single question they can answer in one word, asking permission to send the breakdown. No meeting ask, no call ask, no video ask, no 'worth 15 minutes', no second CTA of any kind, and this holds even when the redesign link is present. Two question marks aimed at the reader means the email is wrong.",
    "4. Exactly ONE finding. Not three facts. A stranger who reads two findings reads a pitch.",
    redesignUrl
      ? "5. Under 180 words for the body. The extra room over a linkless email exists ONLY for concrete specifics about what you built them."
      : "5. Under 120 words for the body.",
    "6. End with a one-line sign-off (first name, then the agency name on its own line). No signature block.",
    'Subject line: short and specific, naming the business and the engine, for example "Cellunetics + ChatGPT". No score, no numbers, no bait, no question mark.',
    "Do NOT use em dashes or en dashes anywhere, and never ' - ' as a connector. Use commas and periods. Ranges use 'to'.",
    PARAGRAPH_RULES,
    VOICE_RULES,
    // Says "clients", never "patients": this block ships for every vertical.
    "Never guarantee customers, clients, sales or revenue. Never invent a statistic, a screenshot or a competitor name that is not in the findings given.",
    PROSPECT_FIELDS_INSTRUCTION,
    "REFERENCE EMAIL. Match its rhythm, its paragraph density and its restraint. Do NOT reuse its wording, its business, or its details:",
    "---",
    redesignUrl ? PERMISSION_EXAMPLE_WITH_REDESIGN : PERMISSION_EXAMPLE_NO_REDESIGN,
    "---",
  ].join("\n");
}

const DRAFT_SCHEMA_HINT =
  '{ "subject": string, "body": string, "prospect_name": string|null, "prospect_email": string|null, "redesign_url": string|null }';

interface RawIntakeDraft {
  subject: string;
  body: string;
  prospect_name?: string | null;
  prospect_email?: string | null;
  redesign_url?: string | null;
}

function isRawIntakeDraft(v: unknown): v is RawIntakeDraft {
  if (typeof v !== "object" || v === null) return false;
  const o = v as RawIntakeDraft;
  return typeof o.subject === "string" && typeof o.body === "string" && o.body.trim().length > 0;
}

function cleanText(v: string | null | undefined): string | null {
  const trimmed = (v ?? "").trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "null" ? trimmed : null;
}

/**
 * Turn Matthew's free-text answers into ONE finished email 1.
 *
 * The answers are handed over verbatim rather than parsed into fields first: he types things
 * like "3. mention their 2012 site but don't say the score", and any parser that guessed at
 * structure would drop half the instruction. The model reads the questions it asked next to
 * the reply, and the recipient details come back as extracted fields in the same call.
 */
export async function draftFromIntake(
  report: AuditReportRow,
  view: ReportView,
  answers: string
): Promise<IntakeDraftResult> {
  const redesignUrl = report.redesign_url ?? redesignFromAnswers(answers);

  const { data } = await callClaudeJSON<RawIntakeDraft>({
    model: MODEL,
    system: intakeDraftSystem(redesignUrl),
    user: [
      `Audit findings (use the real numbers and real competitor names, never invent one):\n${reportContext(report, view)}`,
      `\nThe questions asked:\n${questionBlock(report)}`,
      `\nMatthew's answers, verbatim. These OUTRANK the generic guidance, follow them literally. If he says to mention something, mention it. If he says to leave something out, it does not appear:\n"""\n${answers}\n"""`,
      `\nReturn email 1 as JSON.`,
    ].join("\n"),
    maxTokens: 1600,
    temperature: 0.6,
    schemaHint: DRAFT_SCHEMA_HINT,
    validate: isRawIntakeDraft,
  });

  const policy: LinkPolicy = redesignUrl ? { mode: "redesign_only", url: redesignUrl } : { mode: "none" };
  const subject = enforceLinkPolicy(noDashes(data.subject), { mode: "none" });
  const body = enforceLinkPolicy(noDashes(data.body), policy);
  const polished = await polishBody(body.text, { allowEmphasis: false });

  return {
    draft: {
      label: "Email 1 · permission",
      subject: subject.text.trim(),
      body: polished.body.trim(),
    },
    extracted: {
      prospect_name: cleanText(data.prospect_name),
      prospect_email: cleanText(data.prospect_email),
      // Prefer what the model pulled out; fall back to the raw scan so a link Matthew pasted
      // is still stored for the reveal even if the model omitted the field.
      redesign_url: cleanText(data.redesign_url) ?? redesignFromAnswers(answers),
    },
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
  };
}

/**
 * Revise the draft already sitting in pending_drafts from an instruction like "tighter" or
 * "drop the 2012 line". Rewrites in place so the thread never accumulates near-identical
 * cards, and re-applies the same no-links/no-price constraints so a revision can't quietly
 * reintroduce a pitch.
 */
export async function revisePreviousDraft(
  report: AuditReportRow,
  view: ReportView,
  previous: EmailOption,
  instruction: string
): Promise<IntakeDraftResult> {
  const policy = linkPolicyFor(report);
  const isPermissionStage = policy.mode !== "any";

  const { data } = await callClaudeJSON<{ subject: string; body: string }>({
    model: MODEL,
    system: [
      "You revise a cold outreach email for SRT Agency LLC, an AI-search-visibility agency, on the founder's instruction.",
      "Change what he asked for and leave everything else alone. This is an edit, not a rewrite: if he says to cut a line, cut that line and do not restructure the email around it.",
      policy.mode === "none"
        ? "This email is in the PERMISSION stage, so the constraints still hold no matter what: no URLs or links of any kind, no price, no meeting or call or video ask, exactly one finding, under 120 words. Its only ask is permission to send the breakdown over, asked once, as the last line."
        : policy.mode === "redesign_only"
          ? `This email is in the PERMISSION stage. The constraints still hold no matter what: no price, no meeting or call or video ask, exactly one finding, under 180 words, and its only ask is permission to send the breakdown, asked once as the last line. EXACTLY ONE link is allowed and it is this one: ${policy.url}. No other URL may appear.`
          : "This email is post-reveal, so links and the offer are allowed.",
      "Do NOT use em dashes or en dashes anywhere, and never ' - ' as a connector.",
      isPermissionStage ? PARAGRAPH_RULES : "",
      "Never guarantee customers, clients or revenue. Never invent a statistic or a competitor name not present in the findings.",
      "Write in the buyer language of this business's own industry. Never import vocabulary from another one.",
      "Keep the subject line unless he asked about the subject line.",
    ]
      .filter(Boolean)
      .join("\n"),
    user: [
      `Audit findings for reference:\n${reportContext(report, view)}`,
      report.intake_answers ? `\nEarlier instructions for this outreach, still in force:\n"""\n${report.intake_answers}\n"""` : "",
      `\nCurrent draft:\nSubject: ${previous.subject}\n\n${previous.body}`,
      `\nWhat to change:\n"""\n${instruction}\n"""`,
      `\nReturn the revised email as JSON.`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 1400,
    temperature: 0.5,
    schemaHint: '{ "subject": string, "body": string }',
    validate: (v: unknown): v is { subject: string; body: string } =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { subject?: unknown }).subject === "string" &&
      typeof (v as { body?: unknown }).body === "string" &&
      (v as { body: string }).body.trim().length > 0,
  });

  const subject = enforceLinkPolicy(noDashes(data.subject), isPermissionStage ? { mode: "none" } : { mode: "any" });
  const body = enforceLinkPolicy(noDashes(data.body), policy);
  const polished = await polishBody(body.text, { allowEmphasis: !isPermissionStage });

  return {
    draft: { label: previous.label, subject: subject.text.trim(), body: polished.body.trim() },
    extracted: { prospect_name: null, prospect_email: null, redesign_url: null },
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
  };
}
