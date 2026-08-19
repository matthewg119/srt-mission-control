// SMS AI Draft Engine — generates stage-appropriate reply suggestions.
// Called after every inbound message. Draft is posted to Slack for Matthew's approval.
//
// The draft logic is split into two pieces:
//   - generateDraft(input)  — pure builder: takes stage + inbound + history and
//                             produces a draft. No DB conversation required, so the
//                             simulator can reuse it in a sandbox.
//   - draftSmsReply(convId) — back-compat wrapper: loads the real conversation,
//                             contact, and history, then delegates to generateDraft.
//
// Persona prompts now come from the bot_persona table when present (live-editable),
// and real (incoming -> reply) voice examples are retrieved via pg_trgm and injected
// as few-shot examples. If the DB has no persona/voice rows, the hardcoded prompts
// below are used so behavior is unchanged until the tables are populated.

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/db";
import {
  resolveTenantId,
  loadPersona,
  matchVoiceExamples,
  renderStyleProfile,
  renderVoiceExamples,
} from "@/lib/persona";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// A transient error is one worth retrying once: Anthropic overload/rate-limit/5xx,
// or a network/timeout blip. Permanent errors (bad request, 401) surface immediately.
function isTransientError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  const name = (err as { name?: string })?.name ?? "";
  if (name === "AbortError") return true;
  const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  return /overloaded|rate.?limit|timeout|timed out|econnreset|etimedout|enotfound|socket hang up|fetch failed|network/.test(
    msg
  );
}

// Call Claude with a hard timeout and a single retry on transient failure. Throws
// the real error on permanent failure or after the retry is exhausted.
async function createMessageWithRetry(
  params: Anthropic.MessageCreateParamsNonStreaming,
  timeoutMs = 20000
): Promise<Anthropic.Message> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await anthropic.messages.create(params, { signal: ctrl.signal });
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && isTransientError(err)) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// SRT sells one thing: making sure that when someone asks an AI assistant for a
// business like theirs, it names them. The four stages are the actual motion,
// from first touch to the free first build. See src/config/pitch.ts for the
// canonical offer, the two tiers and the lines that may never be invented.
//
// Rules that hold across every stage, because a text is as unretractable as an
// email: never promise customers, calls, jobs or revenue; never guarantee
// anything; never attach an expiry or a slot count to the free build. Never say
// "AEO", "GEO", "LLM" or "schema" to a prospect, they are banned jargon
// (src/config/pitch.ts BANNED_JARGON). Never say Google is dead or that everyone
// uses AI now.
const OFFER_RULES = `SRT Agency is Search Retrieval Tactics. We do one thing: make sure that when someone asks ChatGPT or another AI assistant for a business like theirs, it names them. That is not advertising and it is not SEO.
Never promise more customers, calls, jobs, leads or revenue, and never use the word guarantee. We report visibility, we do not predict sales.
Never say "AEO", "GEO", "LLM", "schema" or "citations". Say "the answers AI gives about you" or "AI search".
Never say Google is dead or that everyone uses AI now. Both are false and both cost the reply.`;

const STAGE_PROMPTS: Record<number, string> = {
  1: `You are texting on behalf of Matthew at SRT Agency.
${OFFER_RULES}
Stage 1: First touch. Goal is one yes, to run them a free AI visibility check: we ask the AI assistants the questions their buyers ask and see who gets named.
Keep it casual, first-name basis, max 3 sentences. Sound like a real person, not a bot.
Ask what the business does and where it is if you do not already know. Do not ask about revenue or time in business, neither is relevant to what we sell.
If they are interested, the link is https://srtagency.com/audit
Emojis: max 1-2. No corporate language. Never say "unfortunately" or "I apologize".`,

  2: `You are texting on behalf of Matthew at SRT Agency.
${OFFER_RULES}
Stage 2: The check is running. They said yes and we are pulling their report.
Keep them warm and DO NOT invent a result, a score or a competitor name. Nothing is known yet.
Brief, 1-2 sentences. Sound like someone actually doing the work.
Example tone: "Running your questions through ChatGPT now. Give me a bit and I'll send over what it actually says about you."`,

  3: `You are texting on behalf of Matthew at SRT Agency.
${OFFER_RULES}
Stage 3: Report delivered. Goal is to get them to actually open it and then take a short call.
Only reference findings that appear in the conversation already. Never invent a score, a number or a competitor.
The strongest line available is that they can check it themselves: run any of those questions in an incognito window and see the same answer.
1-3 sentences. Sound human, not scripted.`,

  4: `You are texting on behalf of Matthew at SRT Agency.
${OFFER_RULES}
Stage 4: Close, and the ask is the free first build, not a price.
We build one section of their own site that AI can actually read and cite. It is free, there is no card, and they keep it either way. All they have to do is say yes.
It has NO expiry and NO scarcity. Never say "this month only" or "two slots left". Inventing one turns a true offer into a false one.
Pricing is a separate, later conversation. If they ask what it costs after that, it is $349 a month for Core or $499 a month for Complete, and those are the only two figures that exist. Never derive a third by discounting, halving or breaking it down per day.
Be direct and specific. Keep it under 4 sentences.`,
};

// Used for iMessage threads that have no funnel stage set (personal Apple ID
// conversations the Mac bridge ingests). One adaptive prompt — the "data
// response model" — reads the thread and responds in Matthew's voice.
const ADAPTIVE_PROMPT = `You are drafting a reply on behalf of Matthew at SRT Agency, texting from his personal line.
${OFFER_RULES}
Read the conversation and reply naturally in Matthew's voice: casual, first-name basis, direct, no corporate language. Sound like a real person, not a bot.
Move the relationship forward. Answer their question, or push toward the next step based on where the thread actually is: the free AI visibility check, getting them to open the report, a short call, or the free first build.
Some of these people were funding leads years ago and their old messages may say so. That is not why we are writing. Never pick the thread back up on financing, loans, lenders, statements or capital.
Keep it short (1-3 sentences). Max 1-2 emojis. Never say "unfortunately" or "I apologize". If they want the free check and have not had it, the link is https://srtagency.com/audit`;

export interface DraftHistoryMessage {
  direction: "inbound" | "outbound";
  body: string;
}

export interface GenerateDraftInput {
  tenantId: string;
  stage: number | null;
  inboundMessage: string;
  history: DraftHistoryMessage[];
  contact?: {
    firstName?: string | null;
    businessName?: string | null;
    monthlyRevenue?: number | null;
  } | null;
  paymentFlexibility?: string | null;
  remixInstruction?: string;
  // Set false to skip the Spanish auto-translate (e.g. simulator clarity).
  translateSpanish?: boolean;
}

export interface SuggestedFollowup {
  days: number;
  reason: string;
}

export interface GenerateDraftResult {
  draft: string | null;
  // Few-shot examples that were injected, surfaced for the simulator debug panel.
  voiceExamples: { incoming: string; reply: string }[];
  // Where the system prompt came from, for observability.
  personaSource: "db" | "hardcoded";
  // Set when the model decided a proactive follow-up is warranted (future decision
  // date / soft objection). Parsed out of a machine-readable trailer the lead never
  // sees. Null when no follow-up is warranted.
  suggestedFollowup: SuggestedFollowup | null;
  // The real failure reason when draft is null (LLM error, missing key, etc.).
  error?: string;
}

// Product-agnostic steer: when a lead pushes a decision into the future or soft-
// objects, do not just agree and wait — acknowledge, offer to prep now, say what's
// needed + rough timeline, and propose a follow-up. The specific pitch comes from
// the persona/stage guidance so it stays trainable in the simulator. The trailer
// is parsed out and stripped before the lead ever sees the reply.
const FOLLOWUP_INSTRUCTION = `\n\nIf the lead gives a future decision date, a "not yet" / "thinking about it", or asks to be contacted later: do NOT just agree and wait. Acknowledge their timeline, offer to start preparing their options now, briefly state what you would need from them and the rough timeline, and propose a specific follow-up. Use the program and offer framing from your persona/stage guidance (do not invent a product that is not in your guidance).
When (and only when) a follow-up is warranted, after your reply add a final line EXACTLY in this format (the lead never sees it, it is stripped before sending): <<FOLLOWUP days=N reason="short reason">> where N is a whole number of days until the follow-up and the reason is a short phrase. Omit this line entirely when no follow-up is warranted.`;

// Parse + strip the <<FOLLOWUP days=N reason="...">> trailer from a model reply.
// Robust to it being absent, malformed, or on its own line. Returns the cleaned
// draft text plus the parsed follow-up (null when absent/malformed).
function extractFollowup(text: string): { draft: string; followup: SuggestedFollowup | null } {
  const re = /<<\s*FOLLOWUP\s+days\s*=\s*(\d+)\s+reason\s*=\s*"([^"]*)"\s*>>/i;
  const match = text.match(re);
  // Always strip any trailer-looking token so the lead never sees it.
  const draft = text.replace(/<<\s*FOLLOWUP[^>]*>>/gi, "").trim();
  if (!match) return { draft, followup: null };
  const days = parseInt(match[1], 10);
  const reason = (match[2] || "").trim();
  if (!Number.isFinite(days) || days <= 0 || !reason) return { draft, followup: null };
  return { draft, followup: { days, reason } };
}

/**
 * Pure draft builder. Loads persona + voice examples for the tenant, assembles
 * the prompt, and calls Claude. Does NOT touch sms_conversations/sms_messages.
 */
export async function generateDraft(input: GenerateDraftInput): Promise<GenerateDraftResult> {
  const {
    tenantId,
    stage,
    inboundMessage,
    history,
    contact,
    paymentFlexibility,
    remixInstruction,
    translateSpanish = true,
  } = input;

  if (!process.env.ANTHROPIC_API_KEY) {
    const error = "ANTHROPIC_API_KEY missing at runtime";
    console.error("[sms-ai-engine]", error);
    return { draft: null, voiceExamples: [], personaSource: "hardcoded", suggestedFollowup: null, error };
  }

  try {
    // Persona (DB) with hardcoded fallback.
    const persona = await loadPersona(tenantId);
    let personaSource: "db" | "hardcoded" = "hardcoded";
    let systemPrompt: string;
    if (persona) {
      const fromDb =
        stage != null ? persona.byStage[stage] ?? persona.base : persona.base;
      if (fromDb) {
        systemPrompt = fromDb;
        personaSource = "db";
      } else {
        systemPrompt = stage != null ? STAGE_PROMPTS[stage] ?? ADAPTIVE_PROMPT : ADAPTIVE_PROMPT;
      }
      systemPrompt += renderStyleProfile(persona.styleProfile);
    } else {
      systemPrompt = stage != null ? STAGE_PROMPTS[stage] ?? ADAPTIVE_PROMPT : ADAPTIVE_PROMPT;
    }

    // Voice few-shot retrieval.
    const voiceExamples = await matchVoiceExamples(tenantId, inboundMessage, 6);
    systemPrompt += renderVoiceExamples(voiceExamples);

    // Proactive follow-up steer (product-agnostic; specifics come from persona).
    systemPrompt += FOLLOWUP_INSTRUCTION;

    // Hard style rule enforced for every persona (built-in or live-edited).
    systemPrompt += "\n\nNever use em dashes or en dashes (—, –). Use commas, periods, or hyphens instead.";

    const merchantName = contact?.firstName ?? "there";
    const historyText = history
      .map((m) => `${m.direction === "inbound" ? "Merchant" : "Matthew"}: ${m.body}`)
      .join("\n");

    const userPrompt = [
      `Merchant first name: ${merchantName}`,
      contact?.businessName ? `Business: ${contact.businessName}` : null,
      contact?.monthlyRevenue ? `Monthly revenue: $${contact.monthlyRevenue.toLocaleString()}` : null,
      paymentFlexibility ? `Payment flexibility answer: ${paymentFlexibility}` : null,
      ``,
      `Recent conversation:`,
      historyText || "(no prior messages)",
      ``,
      `Latest inbound message: "${inboundMessage}"`,
      remixInstruction ? `\nAdjust the draft per this instruction: ${remixInstruction}` : null,
      ``,
      `Reply with ONLY the text message body — no quotes, no prefix, no explanation.`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await createMessageWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      // Slightly high so 🔄 Regenerate yields a genuinely different variation.
      temperature: 0.8,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text.trim() : null;

    // Parse + strip the FOLLOWUP trailer BEFORE any translation so the lead-facing
    // body never contains it and the suggestion survives the translate step.
    let suggestedFollowup: SuggestedFollowup | null = null;
    let draft: string | null = null;
    if (rawText != null) {
      const parsed = extractFollowup(rawText);
      draft = parsed.draft || null;
      suggestedFollowup = parsed.followup;
    }

    // If merchant wrote in Spanish, detect and re-draft in Spanish
    if (draft && translateSpanish && isSpanish(inboundMessage) && !isSpanish(draft)) {
      draft = await translateToSpanish(draft);
    }

    return { draft, voiceExamples, personaSource, suggestedFollowup };
  } catch (err) {
    console.error("[sms-ai-engine] generateDraft error:", err);
    const error =
      (err as { error?: { message?: string } })?.error?.message ??
      (err as { message?: string })?.message ??
      String(err);
    return { draft: null, voiceExamples: [], personaSource: "hardcoded", suggestedFollowup: null, error };
  }
}

export interface DraftSmsReplyResult {
  draft: string | null;
  suggestedFollowup: SuggestedFollowup | null;
  error?: string;
}

export async function draftSmsReply(
  conversationId: string,
  inboundMessage: string,
  // Optional free-text steer from the Slack "🎛 Remix" modal, e.g. "make it
  // shorter", "more urgent", "answer their pricing question directly".
  remixInstruction?: string
): Promise<DraftSmsReplyResult> {
  try {
    // Load conversation state
    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .select("close_stage, payment_flexibility, contact_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (!conv) return { draft: null, suggestedFollowup: null, error: "conversation not found" };

    const stage = (conv.close_stage as number | null) ?? null;

    // Load contact info
    const { data: contact } = conv.contact_id
      ? await supabaseAdmin
          .from("contacts")
          .select("first_name, business_name, monthly_revenue, time_in_business")
          .eq("id", conv.contact_id)
          .maybeSingle()
      : { data: null };

    // Load last 10 messages for context
    const { data: messages } = await supabaseAdmin
      .from("sms_messages")
      .select("direction, body, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(10);

    const history: DraftHistoryMessage[] = (messages ?? [])
      .reverse()
      .map((m) => ({ direction: m.direction as "inbound" | "outbound", body: m.body as string }));

    const tenantId = (await resolveTenantId()) ?? "";

    const { draft, suggestedFollowup, error } = await generateDraft({
      tenantId,
      stage,
      inboundMessage,
      history,
      contact: contact
        ? {
            firstName: contact.first_name,
            businessName: contact.business_name,
            monthlyRevenue: contact.monthly_revenue,
          }
        : null,
      paymentFlexibility: conv.payment_flexibility ?? null,
      remixInstruction,
    });

    return { draft, suggestedFollowup, error };
  } catch (err) {
    console.error("[sms-ai-engine] draftSmsReply error:", err);
    return { draft: null, suggestedFollowup: null, error: (err as { message?: string })?.message ?? String(err) };
  }
}

function isSpanish(text: string): boolean {
  const spanishWords = ["gracias", "hola", "qué", "para", "cómo", "está", "tengo", "también", "pero", "porque"];
  const lower = text.toLowerCase();
  return spanishWords.filter((w) => lower.includes(w)).length >= 2;
}

async function translateToSpanish(englishDraft: string): Promise<string> {
  try {
    const response = await createMessageWithRetry({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Translate this SMS to casual Mexican Spanish. Keep it natural and short. Reply with ONLY the translation:\n\n${englishDraft}`,
        },
      ],
    });
    return response.content[0]?.type === "text" ? response.content[0].text.trim() : englishDraft;
  } catch {
    return englishDraft;
  }
}
