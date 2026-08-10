// What happened on the call, written up once, for review.
//
// Today Matthew types the note into Zoho by hand after every call. This drafts it from the live
// transcript the coach already captured, plus the CLOSER checklist and the tagged notes Claude
// extracted during the call, and hands it to him as one Slack card with a 👍.
//
// ‼️ Sonnet, not Haiku. Haiku is the live-call choice because TTFT is everything mid-dial. This
// text goes into the CRM and stays there forever, so it is the accuracy choice, once, after the
// call has already ended.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { OFFER_TIERS } from "@/config/pitch";
import type { CoachCallType } from "./call-type";

const MODEL = "claude-sonnet-4-6" as const;

export type CallOutcome =
  | "connected_interested"
  | "connected_not_interested"
  | "callback_scheduled"
  | "voicemail"
  | "gatekeeper"
  | "wrong_number"
  | "no_answer"
  | "unclear";

const OUTCOMES: CallOutcome[] = [
  "connected_interested",
  "connected_not_interested",
  "callback_scheduled",
  "voicemail",
  "gatekeeper",
  "wrong_number",
  "no_answer",
  "unclear",
];

export interface CallWrap {
  /** Goes into the Zoho note verbatim on 👍. Plain text, no markdown. */
  noteText: string;
  outcome: CallOutcome;
  /** What was actually agreed. Null when nothing was, which is most calls. */
  nextStep: string | null;
  /** ISO date, only when a date was actually said out loud. */
  nextStepAt: string | null;
  emailSubject: string;
  emailBody: string;
  /** Things the transcript could not settle. Shown above the card, never smoothed over. */
  flags: string[];
}

export interface TranscriptTurn {
  speaker: string;
  text: string;
}

/**
 * Read the transcript from the database, not from the request.
 *
 * It is already there, already scoped by session, and already the authoritative copy. Taking it
 * from the extension would let a bad client forge a call that never happened into a CRM note.
 */
export async function loadTranscript(sessionId: string): Promise<TranscriptTurn[]> {
  const { data } = await supabaseAdmin
    .from("call_coach_transcripts")
    .select("speaker, text, sequence_num")
    .eq("session_id", sessionId)
    .order("sequence_num", { ascending: true });

  return (data ?? []).map((r) => ({
    speaker: (r.speaker as string) === "rep" ? "MATTHEW" : "THEM",
    text: (r.text as string) ?? "",
  }));
}

/**
 * The transcript is not trustworthy at the word level, and the prompt has to say so.
 *
 * Speaker labels ARE authoritative: they come from which socket the audio arrived on, and
 * guessSpeaker() is gone. The WORDS are not. ElevenLabs commits garbage on cross-talk, on
 * Spanglish, and on phone-codec audio, and a model handed a garbled number will write it into the
 * CRM as a fact. Hence: never report a heard number as confirmed, and `unclear` is a real answer.
 */
const TRANSCRIPT_CAVEAT = [
  "ABOUT THIS TRANSCRIPT:",
  "- WHO said each line is reliable. It comes from which microphone the audio arrived on, not from guessing.",
  "- WHAT they said is NOT reliable. This is live phone audio through automatic transcription. It garbles names, numbers, company names and anything said over cross-talk, and it mangles Spanish badly.",
  "- Therefore: never write a number you only heard (a price they quoted, a headcount, a revenue figure, a date) as if it were confirmed. Say \"sounds like\" or leave it out.",
  "- Never invent a commitment. If nobody actually agreed to anything, nextStep is null. A follow-up that exists only because you wrote it down is worse than no follow-up.",
  "- If the transcript is too thin or too garbled to say what happened, return outcome \"unclear\" and say so in noteText. That is an honest answer and it is available to you.",
].join("\n");

export async function generateWrap(input: {
  sessionId: string;
  callType: CoachCallType | null;
  who: { businessName: string | null; personName: string | null; zohoRef: string };
  qualification: Record<string, string | null>;
  notes: string[];
  durationSeconds: number | null;
  briefText: string | null;
}): Promise<CallWrap> {
  const turns = await loadTranscript(input.sessionId);

  if (turns.length === 0) {
    throw new Error("No transcript rows for that session, so there is nothing to write up.");
  }

  const convo = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");

  const checklist = Object.entries(input.qualification)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const tiers = OFFER_TIERS.map((t) => `${t.name} ${t.price}`).join(" or ");

  const { data } = await callClaudeJSON<CallWrap>({
    model: MODEL,
    system: [
      "You write up a sales call that just ended, for the CRM and for a follow-up email. You are writing FOR Matthew, the rep, in his own voice, about a call you have the transcript of.",
      "",
      TRANSCRIPT_CAVEAT,
      "",
      "noteText: what happened, for the CRM. Plain text, no markdown, no bullets, 3 to 6 short lines. What they said, what they objected to, what was agreed. Written so that reading it in three weeks tells him what he needs to know before dialing again. It is a record, not a summary of your own reasoning: do not narrate the call structure, do not grade the call, do not say what should have been done differently.",
      "",
      "outcome: exactly one of " + OUTCOMES.join(", ") + ". voicemail and no_answer are different: voicemail means a message was left.",
      "",
      "nextStep: what was actually agreed, in one line, or null. nextStepAt: an ISO date ONLY if a specific day was actually said. \"I'll call you next week\" is not a date; \"Thursday\" is, and today's date is in the user message so you can resolve it.",
      "",
      "emailSubject and emailBody: the follow-up email to send after this call. It goes out as a REPLY on the existing thread when one exists, so do not re-introduce yourself. Reference the actual conversation, not the audit in general. Short. One ask at the end, the smallest one that moves this forward. If the call went badly or they said no, write the graceful version that leaves the door open rather than pretending it went well.",
      "",
      "HARD LINES, no exceptions:",
      "- There is NO guarantee. Never say guaranteed, risk-free, money-back, or anything implying one.",
      "- Never promise customers, jobs, leads or revenue. This measures VISIBILITY only.",
      `- The only prices that exist are ${tiers}. Never invent a third figure, never do arithmetic on these two, and do not mention price at all unless it actually came up on the call.`,
      "- Never claim reach: no \"in front of X more people\". Nothing measures that.",
      "- No em dashes, no en dashes, never ' - ' as a connector.",
      "",
      "flags: anything you could not settle from the transcript. A number you heard but would not write down. A commitment that was ambiguous. A name you could not make out. Empty array when the transcript was clean. Never smooth over a gap by choosing the likelier option.",
    ].join("\n"),
    user: [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      `Who was called: ${input.who.businessName ?? "unknown business"}${input.who.personName ? `, ${input.who.personName}` : ""} (${input.who.zohoRef})`,
      input.callType ? `What kind of call this was meant to be: ${input.callType}` : "",
      input.durationSeconds ? `Call length: about ${Math.round(input.durationSeconds / 60)} minutes.` : "",
      "",
      input.briefText ? `THE BRIEF HE DIALED WITH (facts about this prospect, already verified, safe to reuse):\n${input.briefText.slice(0, 2500)}` : "",
      "",
      checklist ? `WHAT THE LIVE COACH EXTRACTED DURING THE CALL (its own structured read, cleaner than the raw transcript):\n${checklist}` : "",
      input.notes.length ? `TAGGED NOTES FROM THE CALL:\n${input.notes.map((n) => `- ${n}`).join("\n")}` : "",
      "",
      `TRANSCRIPT:\n${convo.slice(0, 24000)}`,
      "",
      "Return the write-up as JSON.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 2000,
    temperature: 0.2,
    schemaHint:
      '{ "noteText": string, "outcome": string, "nextStep": string|null, "nextStepAt": string|null, "emailSubject": string, "emailBody": string, "flags": string[] }',
    coerce: camelizeKeys,
    validate: (v: unknown): v is CallWrap => {
      const o = v as CallWrap;
      return (
        !!o &&
        typeof o.noteText === "string" &&
        o.noteText.trim().length > 0 &&
        OUTCOMES.includes(o.outcome) &&
        typeof o.emailSubject === "string" &&
        typeof o.emailBody === "string"
      );
    },
    describeInvalid: (v: unknown) => {
      const o = v as Partial<CallWrap>;
      if (!o?.noteText?.trim()) return "`noteText` is missing or empty. It is the CRM record and cannot be blank.";
      if (!OUTCOMES.includes(o.outcome as CallOutcome))
        return `\`outcome\` was "${o.outcome}". It must be exactly one of: ${OUTCOMES.join(", ")}.`;
      return "`emailSubject` and `emailBody` must both be strings.";
    },
  });

  return {
    ...data,
    nextStep: data.nextStep?.trim() || null,
    nextStepAt: data.nextStepAt?.trim() || null,
    flags: Array.isArray(data.flags) ? data.flags : [],
  };
}

/** Human label for the card and the Zoho note title. */
export function outcomeLabel(o: CallOutcome): string {
  switch (o) {
    case "connected_interested":
      return "Connected, interested";
    case "connected_not_interested":
      return "Connected, not interested";
    case "callback_scheduled":
      return "Callback scheduled";
    case "voicemail":
      return "Voicemail left";
    case "gatekeeper":
      return "Gatekeeper";
    case "wrong_number":
      return "Wrong number";
    case "no_answer":
      return "No answer";
    case "unclear":
      return "Unclear from the recording";
  }
}
