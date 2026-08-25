// The post-call email: the one that asks for the yes on the Loom, written from what was actually
// said on the phone.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Email 1 is written from the AUDIT. It has to be, because at that point nobody has spoken to the
// prospect and the report is the only thing that is true about them. The moment there has been a
// call that stops being the best material available, and by a wide margin: an owner on the phone
// says what he actually wants in his own words, and no amount of buyer-question analysis produces
// that sentence.
//
// The notes were being thrown away. Matthew pasted a block of them into a live audit thread, it
// fell through every command branch into the reasoning agent, and nothing usable came back.
//
// ── The one rule that makes this different from every other drafter here ────
// THE NOTES OUTRANK THE AVATAR SET. Same doctrine as intake_answers, and the live case is the
// argument: the niche set picked "The Corporate Film Program Buyer" and the owner had spent the
// call explaining he needs to hire TECHNICIANS, not find customers. A draft written off the generic
// pick would have been a well-researched email about the wrong problem, which is worse than a
// generic one because it proves nobody listened.
//
// ── The ask ─────────────────────────────────────────────────────────────────
// Permission to send the Loom, and nothing else. That is PERMISSION_CLOSE, appended in code, so
// this email inherits the single-ask rule and linter rule `missing-close` for free. It is still a
// permission-stage email: no price, no links beyond the redesign exception, one question mark.

import { callClaudeJSON } from "@/lib/claude-calls";
import { OFFER_INCLUDES } from "@/config/pitch";
import {
  COMPLIANCE_RULES,
  PARAGRAPH_RULES,
  STYLE_RULES,
  SUBJECT_LINE_INSTRUCTION,
  VOICE_RULES,
  ensurePermissionClose,
  ensureSignoff,
  enforceLinkPolicy,
  noDashes,
  prePitchRules,
  reportContext,
  type EmailOption,
  type LinkPolicy,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import { spokenPromises } from "./delivery-guards";
import { callbackCommitments, outOfScopeAsks } from "./notes-guards";
import { readAuditThreadNotes, formatAuditThreadNotes } from "@/lib/call-coach/slack-thread";
import { readThreadTruth, formatThreadTruth } from "./thread-truth";
import type { ReportView } from "./report-view";
import type { AuditReportRow } from "./types";

/**
 * How much of the Slack thread to read back.
 *
 * Far above the live coach's 800, because the constraint there does not apply here. That number
 * exists so thread chatter cannot push the measured score out of a 4000-char call brief; this
 * drafter has no such competition, and for it the thread IS the material.
 */
const THREAD_NOTES_BUDGET = 3500;

export interface NotesDraft {
  draft: EmailOption;
  /** Spanish, for Slack only. Never part of the email. Same convention as the delivery email. */
  flags: string[];
  removedLinks: string[];
  formatNote: string | null;
}

/**
 * What we sell, as a closed list, so "can you also do X" has a definite answer.
 *
 * Handed over as the ONLY services that exist. Without it the model treats an adjacent ask as an
 * invitation and writes "we can help with that too", which is a commitment nobody made on a call
 * nobody recorded.
 */
function offerBlock(): string {
  return [
    "WHAT SRT ACTUALLY SELLS. This is the complete list. Nothing outside it exists:",
    // ‼️ THE WORK, WITHOUT THE VALUES. OFFER_INCLUDES carries a "$2,400 value" on each line and
    // none of that belongs in this prompt: this is a scope list, used to decide whether something
    // the notes asked for is a thing we do. A figure in here is a figure a drafter can quote, and
    // the reveal lane is the only written lane that is allowed to name one.
    ...OFFER_INCLUDES.map((o) => `- ${o.work}`),
    "",
    // ‼️ "RUNNING ADS" CAME OFF THIS LIST ON 2026-08-21 AND ONLY HALFWAY OFF. ChatGPT Ads are real
    // and sellable; Google, Meta and a general ad retainer are not, and the gap between those two
    // sentences is where a prospect gets told yes to the wrong thing.
    //
    // ‼️ THEY STOPPED BEING A TIER ON 2026-08-25 AND THEY STILL HAVE NO PRICE HERE. They are an
    // accelerator now, quoted case by case off camera. So this line says we sell them and does not
    // say what they cost, which is the same shape it always had.
    "CHATGPT ADS specifically ARE something we sell, as an add-on quoted case by case. Ads on ANY OTHER platform (Google, Meta, Facebook, Instagram, TikTok) are not, and a general 'run our advertising' retainer is not. Never name a figure for the ads.",
    "If the notes ask for something not on the list above (ads anywhere other than ChatGPT, hiring, staffing, social media management, building them a website), you may NOT offer it, hint at it, or say we can help with it.",
    "What you MAY do, and it is usually the strongest thing in the email, is REPOSITION the work above toward what they said they want. The questions we make a business findable for do not have to be buying questions. If someone wants to be found by future employees rather than by customers, that is the same work pointed at a different question, and saying so is honest. Promising to run their job ads is not.",
  ].join("\n");
}

/** The notes, and everything else we know, each labelled by where it came from. */
function contextBlock(
  report: AuditReportRow,
  view: ReportView,
  notes: string,
  threadNotes: string,
  mailbox: string
): string {
  return [
    "THE CALL NOTES, verbatim, written by Matthew straight after speaking to them.",
    "These OUTRANK everything else in this prompt, including the audit's own idea of who their best customer is. If the notes say what this person wants, that is what they want. Read them for what the OWNER said, in the owner's terms.",
    "They are working notes, so they are terse, sometimes bilingual, and they mix three different things: what the prospect said, what Matthew told himself to do next, and reminders. Only the first kind is email material.",
    '"""',
    notes.trim(),
    '"""',
    "",
    threadNotes ? `${threadNotes}\n` : "",
    mailbox ? `${mailbox}\n` : "",
    "AUDIT FINDINGS. The ONLY source of numbers and competitor names. Never invent either:",
    reportContext(report, view),
  ]
    .filter(Boolean)
    .join("\n");
}

interface RawNotesDraft {
  subject: string;
  body: string;
}

function isRawNotesDraft(v: unknown): v is RawNotesDraft {
  const o = v as RawNotesDraft;
  return !!o && typeof o.subject === "string" && typeof o.body === "string" && o.body.trim().length > 0;
}

/**
 * Draft the email that asks for the yes on the Loom, from the notes plus everything already known.
 *
 * Reads its own context (the Slack thread, the real mailbox) rather than taking it from the caller,
 * so there is one place that decides what a post-call email is grounded in.
 */
export async function draftNotesEmail(
  report: AuditReportRow,
  view: ReportView,
  notes: string,
  retryInstruction = ""
): Promise<NotesDraft> {
  const flags: string[] = [];

  // Read in parallel: neither depends on the other and both are network calls.
  const [thread, truth] = await Promise.all([
    readAuditThreadNotes(report.slack_channel_id, report.slack_thread_ts, THREAD_NOTES_BUDGET).catch(
      () => null
    ),
    readThreadTruth(report).catch(() => null),
  ]);

  // ── The guards, all mechanical, all Slack-only ────────────────────────────
  // A promise in the NOTES is not a promise made to the prospect: these are Matthew's own words to
  // himself, and half the time they are a plan rather than something he said. So this flags and
  // withholds rather than rejecting, the same posture the delivery email takes toward the video.
  const promises = spokenPromises(notes);
  for (const p of promises) {
    flags.push(`Las notas prometen resultados: "${p.phrase}" (${p.detail}). No lo repetí en el correo.`);
  }

  const callbacks = callbackCommitments(notes);
  for (const c of callbacks) {
    flags.push(`Le prometiste una llamada: "${c.line}". Eso es tuyo, no va en el correo.`);
  }

  const outOfScope = outOfScopeAsks(notes);
  for (const o of outOfScope) {
    flags.push(
      `Pidió algo que no vendemos: "${o.line}". El correo reposiciona el trabajo hacia eso, nunca lo ofrece.`
    );
  }

  // Permission stage: the redesign is the only link allowed, and only when one exists.
  const redesignUrl = report.redesign_url ?? null;
  const policy: LinkPolicy = redesignUrl ? { mode: "redesign_only", url: redesignUrl } : { mode: "none" };

  const { data } = await callClaudeJSON<RawNotesDraft>({
    model: "claude-sonnet-4-6",
    system: [
      "You write the email Matthew sends after speaking to a prospect on the phone. He runs SRT Agency ('Search Retrieval Tactics'), which makes businesses findable inside AI answers.",
      "",
      "THE JOB OF THIS EMAIL: get a yes to sending them a short video. That is all. It is not the pitch, it is the door held open after a conversation that already went well enough for them to take the call.",
      "",
      "STRUCTURE:",
      "1. Open on what THEY said, in THEIR words, close enough that they recognise their own sentence. Never open on the audit.",
      "2. ONE finding from the audit, and only as the mechanism for the thing they said they want. The finding is the answer to their problem, not a separate topic.",
      "3. Stop.",
      "",
      "It is a reply on a live conversation, so there is no reintroduction and no explaining who you are. They just spoke to you.",
      "Never write 'as we discussed', 'per our conversation', 'it was great speaking with you', or any other throat-clearing. Say the thing.",
      "Do not repeat anything Matthew told himself to do in the notes. A note saying he will call Saturday is his calendar, not a sentence in this email, and writing it commits him to something he did not say to them.",
      "",
      offerBlock(),
      "",
      prePitchRules(redesignUrl),
      PARAGRAPH_RULES,
      VOICE_RULES,
      STYLE_RULES,
      SUBJECT_LINE_INSTRUCTION,
      COMPLIANCE_RULES,
      "",
      'Return JSON: {"subject":"...","body":"..."}',
    ]
      .filter(Boolean)
      .join("\n"),
    user: [
      contextBlock(
        report,
        view,
        notes,
        formatAuditThreadNotes(thread),
        truth ? formatThreadTruth(truth) : ""
      ),
      promises.length
        ? `\nDo NOT repeat these, they appear in the notes but they are not claims this business makes: ${promises.map((p) => `"${p.phrase}"`).join(", ")}`
        : "",
      callbacks.length
        ? `\nThese are commitments Matthew made to HIMSELF and must not appear in the email in any form: ${callbacks.map((c) => `"${c.line}"`).join(", ")}`
        : "",
      retryInstruction ? `\n${retryInstruction}` : "",
      "\nWrite the email now.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 1200,
    temperature: 0.6,
    schemaHint: '{ "subject": string, "body": string }',
    validate: isRawNotesDraft,
    describeInvalid: (p) => {
      const o = p as Partial<RawNotesDraft>;
      if (typeof o.subject !== "string") return "subject was missing";
      if (typeof o.body !== "string" || !o.body.trim()) return "body was missing or empty";
      return "it did not match the required shape";
    },
  });

  const subject = enforceLinkPolicy(noDashes(data.subject), { mode: "none" });
  const body = enforceLinkPolicy(noDashes(data.body), policy);
  const polished = await polishBody(body.text, { allowEmphasis: false });

  return {
    draft: {
      label: "Post-call",
      subject: subject.text.trim(),
      body: ensureSignoff(ensurePermissionClose(polished.body)),
    },
    flags,
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
  };
}
