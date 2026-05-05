// SMS AI Draft Engine — generates stage-appropriate reply suggestions.
// Called after every inbound message. Draft is posted to Slack for Matthew's approval.

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAGE_PROMPTS: Record<number, string> = {
  1: `You are texting on behalf of Matthew at SRT Agency, a business funding broker.
Stage 1: Soft Pitch. Goals: qualify the merchant, build rapport, and get them to fill out an application.
Keep it casual, first-name basis, max 3 sentences. Sound like a real person, not a bot.
Ask about time in business and monthly revenue if not yet known.
If qualified, send the apply link: https://srtagency.com/bfunding
Emojis: max 1-2. No corporate language. Never say "unfortunately" or "I apologize".`,

  2: `You are texting on behalf of Matthew at SRT Agency.
Stage 2: Wisdom Window (hold period while we shop lenders internally).
The application is in. Keep the merchant warm but DO NOT give a specific offer yet.
Sound like you're working hard on their behalf. Brief, 1-2 sentences max.
Example tone: "Got everything — sending this over to underwriting now. Give me a bit, I want to make sure I fight for the right number 💪"`,

  3: `You are texting on behalf of Matthew at SRT Agency.
Stage 3: UW Drama. Create tension and urgency. Sound slightly stressed but optimistic.
You are "fighting" with underwriting to get the merchant a better deal.
Use one of these angles based on context:
- Pushing back on a low offer
- Flagged something minor, handling it
- Good news / bad news — they moved but want one more thing
- Being real about a tough situation
1-3 sentences max. Sound human, not scripted.`,

  4: `You are texting on behalf of Matthew at SRT Agency.
Stage 4: Close. Present the offer confidently with specific numbers.
If payment flexibility hasn't been asked, ask: "One quick thing — would you be against a daily or weekly payment? Some programs have different cadences."
Be direct, confident, specific. This is the close — make it count.
Keep it under 4 sentences.`,
};

export async function draftSmsReply(
  conversationId: string,
  inboundMessage: string
): Promise<string | null> {
  try {
    // Load conversation state
    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .select("close_stage, payment_flexibility, contact_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (!conv) return null;

    const stage = (conv.close_stage as number) ?? 1;

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

    const history = (messages ?? [])
      .reverse()
      .map((m) => `${m.direction === "inbound" ? "Merchant" : "Matthew"}: ${m.body}`)
      .join("\n");

    const merchantName = contact?.first_name ?? "there";
    const systemPrompt = STAGE_PROMPTS[stage] ?? STAGE_PROMPTS[1];

    const userPrompt = [
      `Merchant first name: ${merchantName}`,
      contact?.business_name ? `Business: ${contact.business_name}` : null,
      contact?.monthly_revenue ? `Monthly revenue: $${contact.monthly_revenue.toLocaleString()}` : null,
      conv.payment_flexibility ? `Payment flexibility answer: ${conv.payment_flexibility}` : null,
      ``,
      `Recent conversation:`,
      history || "(no prior messages)",
      ``,
      `Latest inbound message: "${inboundMessage}"`,
      ``,
      `Reply with ONLY the text message body — no quotes, no prefix, no explanation.`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const draft = response.content[0]?.type === "text" ? response.content[0].text.trim() : null;

    // If merchant wrote in Spanish, detect and re-draft in Spanish
    if (draft && isSpanish(inboundMessage) && !isSpanish(draft)) {
      return await translateToSpanish(draft);
    }

    return draft;
  } catch (err) {
    console.error("[sms-ai-engine] draftSmsReply error:", err);
    return null;
  }
}

function isSpanish(text: string): boolean {
  const spanishWords = ["gracias", "hola", "qué", "para", "cómo", "está", "tengo", "también", "pero", "porque"];
  const lower = text.toLowerCase();
  return spanishWords.filter((w) => lower.includes(w)).length >= 2;
}

async function translateToSpanish(englishDraft: string): Promise<string> {
  try {
    const response = await anthropic.messages.create({
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
