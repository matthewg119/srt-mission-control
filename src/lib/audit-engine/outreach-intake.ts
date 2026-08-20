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
  prePitchRules,
  permissionExample,
  PERMISSION_CLOSE,
  ensureSignoff,
  ensurePermissionClose,
  type EmailOption,
  type LinkPolicy,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";
import { displayName } from "./display-name";
import { submissionsMailbox } from "./lead-pitch";

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
  /** Set when the recipient's name in the draft does not appear in what Matthew typed. */
  nameWarning: string | null;
}

/**
 * Router commands that end up stored as the intake answer.
 *
 * At `awaiting_intake` EVERY free-text reply in the thread is the intake answer, so a word typed
 * in the belief that it is a command is kept verbatim and outranks everything generic from then on.
 * A live run stored the literal string "draft" and the coach brief printed `MY NOTES: draft`, which
 * a model reading that brief mid-call has no way to recognise as noise.
 */
const INTAKE_JUNK = new Set([
  "draft", "drafts", "1", "2", "3", "send", "send it", "sendit", "call", "close", "closing",
  "followup", "follow up", "loom", "script", "full script", "reveal", "delivery", "deliver",
  "image", "avatars", "avatars fresh", "questions", "intake", "ask me", "restart intake",
  "yes", "no", "ok", "okay", "go", "cancel", "stop", "nevermind", "never mind", "test", "testing",
  "na", "n/a", "none", "-", ".",
]);

/**
 * The intake answers, or nothing.
 *
 * Gates the WHOLE blob rather than filtering line by line, and that is deliberate. The real answer
 * is four free-text replies to the four intake slots, so it legitimately contains lines like
 * "Fran", "fran@americanstone.com" and "yes"; a per-line word count would gut a perfectly good
 * answer. What actually goes wrong is the opposite shape, one stray token standing alone, so that
 * is the only thing rejected.
 *
 * It lives HERE, next to the column it guards, rather than in call-script.ts where it was written
 * (2026-08-10). It was only ever applied in buildCallFacts, so it cleaned the live-call brief and
 * nothing else: the drafters, which are what write the email that actually goes to the prospect,
 * read the raw column. Every reader now goes through this, so they cannot disagree about what
 * Matthew said. It is applied on WRITE and on READ, because rows written before this existed still
 * carry whatever was typed.
 */
export function usefulIntakeAnswers(raw: string | null): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return text;

  const bare = lines[0].toLowerCase().replace(/[.!?,]+$/, "").trim();
  if (INTAKE_JUNK.has(bare)) return null;
  // `nudge 2`, `email 3` — a numbered command is junk for the same reason the bare word is.
  if (/^(nudge|email|seed)\s+\d+$/.test(bare)) return null;
  // Too small to be an instruction. A one-word answer costs the ICP framing nothing and the
  // greeting name comes from prospect_name / loom_state.greetName, never from here.
  if (bare.split(/\s+/).filter(Boolean).length < 3 && bare.length < 15) return null;

  return text;
}

/** The subset of a Slack file event this module needs. Structural, so no import from the route. */
export interface IntakeImage {
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

/**
 * Read the screenshots attached to a thread reply, as text.
 *
 * The audit lane used to forward only `text` and then return, which short-circuited the
 * image-capable handler further down the route, so an attached file was discarded in silence. The
 * reply that exposed it was "draft pelase jossana guerrero" with a contact card pasted underneath:
 * the recipient's email was in the picture, the picture was dropped, and the Outlook draft would
 * have gone out with an empty To even if the draft itself had survived the linter.
 *
 * Transcribes rather than interprets. What comes back is appended to the intake answers, and the
 * answers are quoted to the drafter as instructions that outrank everything generic, so a model
 * summarizing what it thinks the picture MEANS would be putting its own guesses in that position.
 * Returns null on any failure: a screenshot that could not be read must not take the draft with it.
 */
export async function readIntakeImages(files: IntakeImage[]): Promise<string | null> {
  const images = files.filter((f) => (f.mimetype ?? "").startsWith("image/")).slice(0, 4);
  if (images.length === 0) return null;

  try {
    const decoded = (
      await Promise.all(
        images.map(async (f) => {
          const url = f.url_private ?? f.url_private_download;
          if (!url) return null;
          const buf = await slack.downloadFile(url);
          return { media_type: (f.mimetype ?? "image/png").split(";")[0], data: buf.toString("base64") };
        })
      )
    ).filter((i): i is { media_type: string; data: string } => i !== null);
    if (decoded.length === 0) return null;

    const { data } = await callClaudeJSON<{ text: string }>({
      model: MODEL,
      system: [
        "You transcribe screenshots that a sales founder pasted into a Slack thread while answering intake questions about who to email.",
        "Report ONLY what is legibly written in the image: names, roles, email addresses, phone numbers, company names, and any other visible text.",
        "Transcribe characters exactly, especially email addresses and spellings of names. Do not correct what looks like a typo, do not complete a partial address, and do not infer a person's role from context.",
        "Do not describe the image, do not summarize it, and do not add anything that is not written in it. If nothing readable is there, return an empty string.",
      ].join("\n"),
      user: "Transcribe the readable text in these images.",
      images: decoded,
      maxTokens: 700,
      temperature: 0,
      schemaHint: '{ "text": string }',
      validate: (v: unknown): v is { text: string } =>
        typeof v === "object" && v !== null && typeof (v as { text?: unknown }).text === "string",
    });

    const text = data.text.trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    console.error("[outreach-intake] could not read attached image:", (e as Error).message);
    return null;
  }
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
 * The intake drafter's system prompt.
 *
 * The hard constraints and the few-shot are CALLED from email-assistant.ts rather than restated
 * here. They used to be a hand-copied second version, and the copy went stale in the worst
 * possible place: prePitchRules() rule 3 says "DO NOT WRITE THE CLOSE... do not ask a question
 * anywhere", because ensurePermissionClose() appends the ask in code. This file's rule 3 said the
 * opposite, "ONE ASK, and it is the last line: a single question". So the model wrote an ask, the
 * code appended a second one, and draft-linter.ts rejected the result for having two question
 * marks — three attempts, every time, with no phrasing that could have satisfied both. Email 1 for
 * a live prospect was unreachable for six days.
 *
 * A comment claiming the two blocks are "kept in sync" is what was there before. Sharing the
 * function is what actually makes it true.
 */
function intakeDraftSystem(redesignUrl: string | null): string {
  return [
    "You write the cold pre-outreach for SRT Agency LLC ('Search Retrieval Tactics'), an AI-search-visibility agency. Matthew personally ran an audit on THIS business before writing, and it shows: every line is specific to them.",
    "Background for YOU, not material to recite: AI engines (ChatGPT, Perplexity, Google AI) do not answer from memory. They search, retrieve a handful of pages, and name 3 to 5 businesses. A business that is not in what gets retrieved is invisible to that buyer no matter how good its work or prices are.",
    "Do NOT explain that mechanism to the reader. A stranger did not sign up for a seminar. You may only get concrete: name what you found, or name what you built them. Specifics earn the reply, theory does not.",
    "Write in the buyer language of THIS business's own industry. Never import vocabulary from another one: a control panel shop has buyers and plant engineers, not patients or clients.",
    `You are writing EMAIL 1, "${PERMISSION_SEQUENCE[0].name}". Its job: ${PERMISSION_SEQUENCE[0].job}`,
    prePitchRules(redesignUrl),
    'Subject line: short and specific, naming the business and the engine, for example "Cellunetics + ChatGPT". No score, no numbers, no bait, no question mark.',
    "Do NOT use em dashes or en dashes anywhere, and never ' - ' as a connector. Use commas and periods. Ranges use 'to'.",
    PARAGRAPH_RULES,
    VOICE_RULES,
    // Says "clients", never "patients": this block ships for every vertical.
    "Never guarantee customers, clients, sales or revenue. Never invent a statistic, a screenshot or a competitor name that is not in the findings given.",
    PROSPECT_FIELDS_INSTRUCTION,
    permissionExample(redesignUrl),
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

/** Letters and digits only, lowercased, so punctuation and spacing cannot mask a real typo. */
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/gi, "");
}

/**
 * A person's name is the one thing in a cold email that must be exactly right, and it is the
 * one thing the model has no source for except Matthew's typed answer.
 *
 * This shipped once: he typed "Jose Luis" and the draft opened "Jose Liuis,". Nothing caught
 * it because the name is produced by the SAME generation that writes the body, and nothing
 * ever compared the two against the answers. Worse, a bad name is then stored on the row and
 * injected as authoritative into every later draft and into the follow-up operator.
 *
 * So: a name that does not appear verbatim in what he typed is not trusted. Each word is
 * checked, because "Dr. Mehta" is a legitimate greeting drawn from "Dr Mehta runs the clinic",
 * while a single word that appears nowhere is a transcription error.
 */
function verifyNameAgainstAnswers(
  name: string | null,
  greeting: string | null,
  answers: string
): { trusted: string | null; warning: string | null } {
  const haystack = nameKey(answers);

  const unsupported = (candidate: string): string[] =>
    candidate
      .split(/\s+/)
      .map((w) => w.replace(/[.,]/g, ""))
      .filter((w) => w.length >= 3 && !/^(dr|mr|mrs|ms|the)$/i.test(w))
      .filter((w) => !haystack.includes(nameKey(w)));

  const badInGreeting = greeting ? unsupported(greeting) : [];
  const badInField = name ? unsupported(name) : [];
  const bad = [...new Set([...badInGreeting, ...badInField])];

  if (!bad.length) return { trusted: name, warning: null };

  return {
    trusted: badInField.length ? null : name,
    warning:
      `:warning: The name in this draft does not match what you typed: ${bad.map((b) => `"${b}"`).join(", ")} ` +
      `${bad.length === 1 ? "appears" : "appear"} nowhere in your answers. Check the greeting before sending.`,
  };
}

/** The name the draft actually greets, from a first line like "Jose Luis," or "Hi Dr. Mehta,". */
function greetingName(body: string): string | null {
  const first = body.trimStart().split("\n")[0]?.trim() ?? "";
  const m = first.match(/^(?:hi|hey|hello|dear)?\s*,?\s*([^,]{1,60}),\s*$/i);
  const captured = m?.[1]?.trim();
  return captured && /[a-z]/i.test(captured) ? captured : null;
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
  rawAnswers: string
): Promise<IntakeDraftResult> {
  // Junk in, junk out, and it stays: whatever lands here is quoted to the model as instructions
  // that outrank everything generic, and is then stored on the row for every later drafter.
  const answers = usefulIntakeAnswers(rawAnswers) ?? "";
  const redesignUrl = report.redesign_url ?? redesignFromAnswers(answers);

  const { data } = await callClaudeJSON<RawIntakeDraft>({
    model: MODEL,
    system: intakeDraftSystem(redesignUrl),
    user: [
      `Audit findings (use the real numbers and real competitor names, never invent one):\n${reportContext(report, view)}`,
      `\nThe questions asked:\n${questionBlock(report)}`,
      answers
        ? `\nMatthew's answers, verbatim. These OUTRANK the generic guidance, follow them literally. If he says to mention something, mention it. If he says to leave something out, it does not appear:\n"""\n${answers}\n"""`
        : // Said plainly, because an empty """ """ block reads as an answer that happened to be
          // blank and the model fills the silence: it invents a recipient and greets them by name.
          `\nMatthew has NOT answered the intake questions. There is no recipient name and no email address. Write email 1 from the audit findings alone, open straight into the first sentence with NO greeting line, and return null for prospect_name and prospect_email. Do not invent a name, a role, or a contact.`,
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
  const signedBody = ensureSignoff(ensurePermissionClose(polished.body));

  const nameCheck = verifyNameAgainstAnswers(
    cleanText(data.prospect_name),
    greetingName(signedBody),
    answers
  );

  return {
    draft: {
      label: "Email 1 · permission",
      // The only email that goes into the shared submissions box as well. Email 1 is the one
      // that opens a conversation, so it is the one worth having in a mailbox someone other
      // than Matthew can see; the nudges and the reveal are one-to-one follow-ups.
      mirrorMailboxes: [submissionsMailbox()],
      subject: subject.text.trim(),
      body: signedBody,
    },
    extracted: {
      prospect_name: nameCheck.trusted,
      prospect_email: cleanText(data.prospect_email),
      // Prefer what the model pulled out; fall back to the raw scan so a link Matthew pasted
      // is still stored for the reveal even if the model omitted the field.
      redesign_url: cleanText(data.redesign_url) ?? redesignFromAnswers(answers),
    },
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
    nameWarning: nameCheck.warning,
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
  const priorAnswers = usefulIntakeAnswers(report.intake_answers);

  // Stated the same way prePitchRules() states it, and for the same reason: ensurePermissionClose()
  // appends the ask below, so a revision that writes its own leaves the email with two. This block
  // used to say "its only ask is permission to send the breakdown, asked once, as the last line",
  // which reads as an instruction to write one.
  const closeRule =
    "The last two paragraphs are the close and they are APPENDED IN CODE, not by you:\n" +
    `"${PERMISSION_CLOSE[0]}"\n"${PERMISSION_CLOSE[1]}"\n` +
    "They are already on the draft below. Leave them exactly as they are, do not reword them, do not move them, and do not write an ask of your own anywhere. Do not put a question mark anywhere else in the email.";

  const { data } = await callClaudeJSON<{ subject: string; body: string }>({
    model: MODEL,
    system: [
      "You revise a cold outreach email for SRT Agency LLC, an AI-search-visibility agency, on the founder's instruction.",
      "Change what he asked for and leave everything else alone. This is an edit, not a rewrite: if he says to cut a line, cut that line and do not restructure the email around it.",
      policy.mode === "none"
        ? `This email is in the PERMISSION stage, so the constraints still hold no matter what: no URLs or links of any kind, no price, no meeting or call or video ask, exactly one finding, under 120 words.\n${closeRule}`
        : policy.mode === "redesign_only"
          ? `This email is in the PERMISSION stage. The constraints still hold no matter what: no price, no meeting or call or video ask, exactly one finding, under 180 words. EXACTLY ONE link is allowed and it is this one: ${policy.url}. No other URL may appear.\n${closeRule}`
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
      priorAnswers ? `\nEarlier instructions for this outreach, still in force:\n"""\n${priorAnswers}\n"""` : "",
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

  // A revision must not be able to talk the close out of the email. The reveal and later stages
  // have their own endings, so this only applies while we are still asking permission.
  const signedBody = ensureSignoff(isPermissionStage ? ensurePermissionClose(polished.body) : polished.body);

  // A revision rewrites the greeting too, so the name check has to run again here. The stored
  // answers are the reference; when there are none there is nothing to check against.
  const nameCheck = priorAnswers
    ? verifyNameAgainstAnswers(null, greetingName(signedBody), priorAnswers)
    : { warning: null };

  return {
    draft: { label: previous.label, subject: subject.text.trim(), body: signedBody },
    extracted: { prospect_name: null, prospect_email: null, redesign_url: null },
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
    nameWarning: nameCheck.warning,
  };
}
