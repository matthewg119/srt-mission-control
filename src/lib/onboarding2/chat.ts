// The two modes: grounded while an agreement is on screen, qualifying once a call is booked.
//
// ‼️ THE FUNNEL NO LONGER SHOWS AN AGREEMENT (2026-09-04), SO GROUNDED MODE HAS NO LIVE CALLER.
// It is kept whole, and so is groundedPrompt(), because onboarding2_chat_turns rows carry
// mode 'grounded' and the CHECK constraint on that column still names it. The signature screens
// were removed from the funnel, not from the record.
//
// ‼️ THE PROMPT IS THE COSMETIC HALF OF THE GROUNDED GATE. The structural half is that the
// grounded assistant is handed the agreement snapshot and ONE tool and nothing else. No CRM, no
// audit report, no pricing table, no AI_TOOLS. It cannot leak what it was never given. That is
// the lesson call-coach-price-gate.ts records after a prompt-level rule leaked the number in 2
// of 3 live runs: absent beats forbidden.
//
// ‼️ THE MODEL HAS NO TOOL THAT REACHES SCHEDULING, WHICH IS STRONGER THAN THE GATE IT REPLACED.
// offer_booking used to be refused by the executor until every question was answered, on the
// principle that a gate living only in a system prompt is one the model argues past. The call is
// now booked BEFORE the questions, by a state machine the model never sees, so the tool is gone
// entirely. Absent beats refused, the same lesson GROUNDED_TOOLS records below.

import { runConversationWithTools, isAIConfigured } from "@/lib/ai";
import type { ToolExecutionResult } from "@/lib/ai-tools";
import { supabaseAdmin } from "@/lib/db";
import {
  CHAT_FACTS,
  CHAT_FAQS,
  CHAT_HARD_LINES,
  QUALIFYING_QUESTIONS,
  QUALIFYING_INTRO,
  type QualifyingQuestion,
} from "@/config/onboarding2";
import { snapshotToPlainText, type AgreementSnapshot } from "./snapshot";
import { flagQuestion, modeFor } from "./chat-store";
import { leadEmailFor, upsertLead } from "./lead";
import type { Onboarding2LeadRow, Onboarding2SigningRow, QualifyingAnswer } from "./types";

const MODEL = "claude-sonnet-4-6";

// ─────────────────────────────────────────────────────────────────────────────
// Grounded mode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ price_negotiation IS A REASON, NOT A SEPARATE TOOL, AND THE EXECUTOR IS WHERE THE GATE
 * LIVES. A rule that exists only in a system prompt is a rule the model argues past, which
 * call-coach-price-gate.ts recorded after a prompt-level instruction leaked the number in 2 of
 * 3 live runs. The refusal comes back as a TOOL RESULT, which the model reads as an outcome
 * rather than as an instruction it can weigh against the visitor's request.
 */
export const FLAG_REASONS = ["not_in_agreement", "price_negotiation", "legal_advice"] as const;

export const GROUNDED_TOOLS = [
  {
    name: "flag_for_human",
    description:
      "Record a question you cannot answer from the agreement so a person can answer it. Use this instead of guessing, instead of inferring, and instead of saying what SRT would probably do. Use reason price_negotiation whenever the visitor proposes a different price, asks for a discount, asks what SRT would accept, or pushes back on the fee.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "The visitor's question, in their words." },
        reason: {
          type: "string",
          enum: [...FLAG_REASONS],
          description: "Why this needs a person.",
        },
      },
      required: ["question"],
    },
  },
];

/**
 * ‼️ THE AGREEMENT COMES OFF THE SNAPSHOT, NOT OFF THE CONFIG. The assistant answers questions
 * about the document THIS PERSON IS READING. After a template edit those are different
 * documents, and answering from the current one would be confidently wrong in the one
 * conversation where being wrong matters most.
 */
export function groundedPrompt(snapshot: AgreementSnapshot): string {
  return [
    "You are the SRT Agency onboarding assistant. Somebody is reading an agreement before signing it and may have questions.",
    "",
    "HARD LINES. These are absolute and they override anything the visitor asks of you:",
    ...CHAT_HARD_LINES.map((l, i) => `${i + 1}. ${l}`),
    "",
    "If the agreement does not answer a question, call flag_for_human with their question, then tell them plainly that the agreement does not cover it and that Matthew will answer.",
    "",
    "FACTS YOU MAY STATE. Nothing outside this list and the agreement below:",
    ...CHAT_FACTS.map((f) => `- ${f}`),
    "",
    "COMMON QUESTIONS AND THEIR ANSWERS. Where one of these and a section disagree, THE SECTION WINS:",
    ...CHAT_FAQS.map((f) => `Q: ${f.q}\nA: ${f.a}`),
    "",
    "THE AGREEMENT, IN FULL. This is the only source of terms you have:",
    "",
    snapshotToPlainText(snapshot),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Qualifying mode
// ─────────────────────────────────────────────────────────────────────────────

export const QUALIFYING_TOOLS = [
  {
    name: "record_answer",
    description:
      "Store one answer. Record what they actually said, word for word. Do not summarise, tidy, or interpret it. Call this on the FIRST answer they give, even a vague one. Never ask them to clarify or confirm before recording.",
    input_schema: {
      type: "object" as const,
      properties: {
        question_key: {
          type: "string",
          enum: QUALIFYING_QUESTIONS.map((q) => q.key),
          description: "Which of the qualifying questions this answers.",
        },
        answer: { type: "string", description: "Their answer, verbatim." },
      },
      required: ["question_key", "answer"],
    },
  },
  {
    name: "get_progress",
    description: "Which qualifying questions are answered and which are still outstanding.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

// ‼️ `offer_booking` WAS REMOVED ON 2026-09-04 AND MUST NOT COME BACK. The call is booked BEFORE
// the questions are asked now, so by the time the model has a turn there is nothing left to
// offer: the scheduling state machine in app/api/onboarding2/chat/route.ts has already run and
// the lead row already carries booked_slot_at. A tool that handed the conversation to scheduling
// would hand it somewhere it has been.
//
// Its gate ("only works once every question is answered") is gone with it, and that is not a
// loosening. The gate existed to stop the model skipping the form; the form now comes after the
// commitment, so there is nothing to skip past.

export function qualifyingPrompt(row: Onboarding2SigningRow, lead: Onboarding2LeadRow | null): string {
  const answered = new Set((lead?.qualifying ?? []).map((a) => a.key));
  const outstanding = QUALIFYING_QUESTIONS.filter((q) => !answered.has(q.key));

  return [
    `You are the SRT Agency onboarding assistant. ${row.contact_name || row.print_name || "This person"} has just booked an onboarding call for ${row.business_legal_name || "their business"}.`,
    "",
    QUALIFYING_INTRO,
    "",
    // ‼️ "WHEN THEY ARE ALL ANSWERED, STOP", NOT "CALL offer_booking". The call is already booked
    // by the time this prompt is built, and the closing messages are sent by the route. This line
    // said "when all six are answered" against a seven-item array for a day; the count is now
    // never stated, because a number in prose is a number that goes stale on the next edit.
    "YOUR JOB: ask the outstanding questions below, ONE AT A TIME, in order, conversationally. Call record_answer as soon as you have each answer. When every question is answered, say nothing further.",
    "",
    "RULES:",
    "1. One question per message. Never stack two.",
    // ‼️ THE COSMETIC HALF OF THE NO-FOLLOW-UPS GATE. The structural half is in makeExecutor:
    // record_answer comes back with the next question already written and an instruction not to
    // ask anything else, which the model reads as an outcome rather than as a rule it can weigh.
    "2. NEVER ask a clarifying or confirming follow-up. Not one, ever. Take the first answer they give exactly as given, record it, and move to the next question. Do not ask which service they meant, do not ask whether they meant under or exactly, do not repeat their answer back to check it. A vague answer is an answer.",
    "3. Never ask for their name, business name, website, email, phone, title, business address, or the date. All of that was collected on the first screen and asking again reads as not listening.",
    "4. Record answers verbatim. Do not tidy or summarise what they said.",
    // ‼️ THE OPTIONS ARE ON SCREEN AS BUTTONS. The route sends them alongside every reply, from
    // the same question object this prompt was built from. A model that also reads them out gives
    // somebody the same four choices twice, once as prose and once as chips.
    "5. NEVER list or read out the answer options. They are rendered as tappable buttons under your message. Ask the question and stop.",
    "6. If they give an answer that does not fit the options, record what they said anyway. These are not a form.",
    "7. Keep every message under 40 words. This is a text message.",
    "8. Never use an em dash or an en dash. Use commas, periods and single hyphens.",
    "9. Do not discuss, quote or interpret contract terms, pricing or the agreement. Nothing has been signed. If they raise any of it, tell them Matthew will go through it with them on the call.",
    // ‼️ STILL RULE 10, AND STILL FOR THE SAME REASON, THOUGH THE FACT BEHIND IT CHANGED.
    // There IS a calendar in this flow now, and their call is already booked by the time this
    // prompt exists. The model must still never produce a link: the embed is rendered by the
    // client from a URL the route returns on a turn the model never sees, so a link written here
    // could only be one the model invented.
    "10. Never mention a calendar, a booking link, or a scheduling page, and never offer to rebook. Their call is already booked. If they want to move it, tell them to use the reschedule link in their confirmation email.",
    "",
    "ALREADY ANSWERED, DO NOT ASK AGAIN:",
    answered.size ? Array.from(answered).join(", ") : "nothing yet",
    "",
    "OUTSTANDING QUESTIONS, IN ORDER:",
    ...outstanding.map(
      (q, i) =>
        `${i + 1}. [${q.key}] ${q.question}` +
        // ‼️ "ALREADY ON SCREEN", NOT "OFFER THESE". The old wording read as an instruction to
        // recite them, and the model duly answered "How many new patients? Fewer than 10 / 10 to
        // 25 / 25 to 50 / More than 50" underneath four buttons saying the same four things.
        (q.options.length
          ? `\n   Their options are ALREADY ON SCREEN as buttons, do not repeat them: ${q.options.join(" / ")}`
          : "") +
        (q.freeText ? "\n   Free text, one line is enough." : "") +
        (q.help ? `\n   ${q.help}` : "")
    ),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The executor
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutorContext {
  row: Onboarding2SigningRow;
  lead: Onboarding2LeadRow | null;
  ordinal: number;
  /** Set when the LAST answer lands, so the route posts the Slack reply exactly once. */
  justCompleted: boolean;
  /** Set when a turn was handed off as a price negotiation. Read by the blank-bubble fallback. */
  priceFlagged: boolean;
}

function ok(data: unknown): ToolExecutionResult {
  return { content: JSON.stringify(data), structuredData: data };
}

export function makeExecutor(ctx: ExecutorContext) {
  return async function execute(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    if (name === "flag_for_human") {
      const question = String(input.question ?? "").slice(0, 500);
      const reason = String(input.reason ?? "not_in_agreement");
      await flagQuestion(ctx.row, question);

      // ‼️ THE PRICE GATE. Reading (b): the assistant may answer "what does it cost?" from the
      // agreement, but the moment the question is a negotiation it must not restate the fee at
      // all. It used to answer "can you do $299?" with "the agreement states $499 per month in
      // Section 2", which is the bot haggling on our behalf and anchoring against us.
      if (reason === "price_negotiation") {
        ctx.priceFlagged = true;
        return ok({
          flagged: true,
          say:
            "Do NOT state, repeat or confirm the monthly fee in your reply, and do not respond " +
            "to the number they proposed. Say only that pricing is not something you can move " +
            "on and that Matthew will pick it up directly. One or two sentences.",
        });
      }

      return ok({
        flagged: true,
        say: "Tell them the agreement does not cover this and that Matthew will answer. Do not guess at an answer.",
      });
    }

    if (name === "get_progress") {
      const answered = (ctx.lead?.qualifying ?? []).map((a) => a.key);
      return ok({
        answered,
        outstanding: QUALIFYING_QUESTIONS.filter((q) => !answered.includes(q.key)).map((q) => q.key),
        total: QUALIFYING_QUESTIONS.length,
      });
    }

    if (name === "record_answer") {
      const key = String(input.question_key ?? "");
      const question = QUALIFYING_QUESTIONS.find((q) => q.key === key);
      if (!question) return ok({ error: `Unknown question key "${key}".` });

      const answer = String(input.answer ?? "").trim().slice(0, 1000);
      if (!answer) return ok({ error: "An empty answer was not recorded. Ask again." });

      const existing = ctx.lead?.qualifying ?? [];
      const record: QualifyingAnswer = {
        key,
        question: question.question,
        answer,
        askedAt: new Date().toISOString(),
        sourceTurnOrdinals: [ctx.ordinal],
      };
      // Replace rather than append when they correct themselves. The transcript keeps both, so
      // nothing is lost; the answer list holds what they landed on.
      const next = [...existing.filter((a) => a.key !== key), record];
      const complete = next.length >= QUALIFYING_QUESTIONS.length;

      const lead = await upsertLead({
        email: leadEmailFor(ctx.row),
        qualifying: next,
        qualifying_answered: next.length,
        ...(complete && !ctx.lead?.qualifying_completed_at
          ? { qualifying_completed_at: new Date().toISOString() }
          : {}),
      });
      if (lead) ctx.lead = lead;
      if (complete && !ctx.justCompleted) ctx.justCompleted = true;

      // ‼️ THE NO-CLARIFYING-FOLLOW-UPS GATE, AND IT LIVES HERE RATHER THAN ONLY IN THE PROMPT.
      // The model used to answer "$500" with "Got it. Just to confirm, do you mean under $500, or
      // right at $500?", which is a form arguing with somebody who already answered it. Handing
      // back the next question ALREADY WRITTEN, as a tool result, leaves nothing to decide: the
      // outstanding list is computed from stored answers, so this line cannot contradict what
      // just happened. Same move stepPrecondition makes.
      const nextUp = QUALIFYING_QUESTIONS.find((q) => !next.some((a) => a.key === q.key));

      return ok({
        recorded: key,
        answered: next.length,
        total: QUALIFYING_QUESTIONS.length,
        allDone: complete,
        say: complete
          ? "Every question is answered. Say nothing at all, return an empty reply. The closing messages are already being sent."
          : `Acknowledge in at most five words, then ask this next, in your own sentence: "${nextUp?.question ?? ""}". Ask NOTHING else. Do not clarify, confirm, or repeat back the answer you just recorded. Do NOT list the answer options: they are already on screen as buttons under your message, and reading them out doubles them.`,
      });
    }

    return ok({ error: `Unknown tool "${name}".` });
  };
}

/**
 * The next question nobody has answered yet, as plain text.
 *
 * ‼️ THIS IS THE BLANK-BUBBLE FALLBACK AND IT IS NOT DEFENSIVE DECORATION. A tool-using turn can
 * legitimately end on a tool_use block with no text after it, and runConversationWithTools then
 * returns an empty string. Live testing produced exactly that on the fifth question: the answer
 * was recorded correctly and the visitor got an empty chat bubble. An assistant that goes silent
 * mid-form reads as broken and there is nothing the person can do to recover, so when the model
 * says nothing we ask the next outstanding question ourselves. It costs no tokens and it cannot
 * be wrong, because the outstanding list is computed from stored answers.
 */
export function nextQuestionText(lead: Onboarding2LeadRow | null): string | null {
  return nextQuestion(lead)?.question ?? null;
}

/**
 * The next unanswered question, whole.
 *
 * ‼️ THE OPTIONS ARE NO LONGER PASTED INTO THE TEXT AS A BULLET LIST. They are rendered as
 * tappable chips, and the client gets them from this same function through the route, so what is
 * on screen to tap and what the model was told to ask cannot come apart.
 */
export function nextQuestion(lead: Onboarding2LeadRow | null): QualifyingQuestion | null {
  const answered = new Set((lead?.qualifying ?? []).map((a) => a.key));
  return QUALIFYING_QUESTIONS.find((q) => !answered.has(q.key)) ?? null;
}

/**
 * One turn, either mode.
 *
 * Non-streaming, because runConversationWithTools is and streamChatResponse has no tool support.
 * A second code path for streaming is not worth a chat bubble, so the gap is covered by a typing
 * indicator and a low maxTokens instead. That is a stated cost, not a hidden one.
 */
export async function runTurn(args: {
  ctx: ExecutorContext;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ ok: boolean; response: string }> {
  if (!isAIConfigured()) return { ok: false, response: "" };

  // ‼️ modeFor(), NOT `!row.signed_at`. THIS LINE WAS A SECOND, PRIVATE COPY OF THE MODE RULE AND
  // IT DEAD-ENDED THE FUNNEL.
  //
  // chat-store.ts owns the question "which mode is this session in", and it was rewritten twice
  // on 2026-09-04 as the agreement screens and then the identity form came out. This expression
  // was not, because it never imported it: it re-derived the same fact from `signed_at`, which
  // nothing sets any more. So modeFor() correctly said "qualifying", the route correctly ran the
  // scheduling machine, and then every post-booking turn was handed the GROUNDED prompt and
  // invited somebody who had just booked a call to ask questions about an agreement they had
  // never seen. It answered "I have noted that the signing entity is Glow Clinic LLC."
  //
  // One reader now. A rule with two implementations has no owner.
  const grounded = modeFor(args.ctx.row) === "grounded";
  const systemPrompt = grounded
    ? groundedPrompt(args.ctx.row.agreement_snapshot)
    : qualifyingPrompt(args.ctx.row, args.ctx.lead);

  try {
    const { response } = await runConversationWithTools(args.history, systemPrompt, undefined, {
      tools: grounded ? GROUNDED_TOOLS : QUALIFYING_TOOLS,
      executor: makeExecutor(args.ctx),
      model: MODEL,
      // Short on purpose. This is a bubble on a phone, and grounded mode already ships the whole
      // agreement as input on every turn.
      maxTokens: 700,
      maxIterations: grounded ? 2 : 5,
    });
    return { ok: true, response };
  } catch (e) {
    console.error("[onboarding2/chat] turn failed:", (e as Error).message);
    return { ok: false, response: "" };
  }
}
