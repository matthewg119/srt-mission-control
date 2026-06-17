// Persona meta-chat (Phase B) — a Claude chat that tunes the bot's persona from
// your typed feedback and optionally pasted screenshots. Claude replies
// conversationally and, when it has a concrete change, returns a `proposal`
// { prompt, style_profile } you can approve (the UI then PUTs /api/persona).
//
// This endpoint does NOT write the persona itself — approval is a separate explicit
// PUT, so nothing changes the live bot until you say so.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a persona-tuning assistant for an SMS sales bot that texts on behalf of Matthew at SRT Agency (a business funding broker). You help refine the bot's SYSTEM PROMPT for a given funnel stage so its drafted replies sound more like Matthew and convert better.

You are given the CURRENT system prompt for a stage and the user's feedback (sometimes with a screenshot of a real text conversation to imitate). Discuss briefly, then when you have a concrete improvement, propose a full rewritten system prompt.

Rules for the prompt you write:
- Keep it a direct system prompt (instructions to the model), not a description.
- Preserve hard constraints already present (e.g. apply link, "never say unfortunately/I apologize", emoji limits) unless the user asks to change them.
- Match Matthew's real voice: casual, first-name basis, short, direct, no corporate language. Never use em dashes.

ALWAYS respond with a single JSON object and nothing else, in this exact shape:
{
  "reply": "<your short conversational message to the user>",
  "proposal": { "prompt": "<full rewritten system prompt>", "style_profile": { "traits": ["..."], "emoji_freq": "low", "avg_len": 120, "banned_phrases": ["..."] } }
}
Set "proposal" to null when you are only asking a clarifying question or have no concrete change yet. Only include style_profile keys you are confident about.`;

interface InMsg {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const stage = body.stage ?? null;
  const currentPrompt = (body.currentPrompt as string | undefined) ?? "(none — using built-in default)";
  const history = (body.messages as InMsg[] | undefined) ?? [];
  const imageBase64 = body.imageBase64 as string | undefined; // data URL or raw base64
  const imageMediaType = (body.imageMediaType as string | undefined) ?? "image/png";

  // Build the message list. The latest user turn may carry an image.
  const messages: Anthropic.MessageParam[] = [];
  messages.push({
    role: "user",
    content: `Stage: ${stage == null ? "Adaptive / base" : stage}\n\nCURRENT SYSTEM PROMPT:\n"""\n${currentPrompt}\n"""\n\nLet's tune this. I'll send feedback next.`,
  });
  messages.push({ role: "assistant", content: JSON.stringify({ reply: "Got it. What would you like to change?", proposal: null }) });

  history.forEach((m, i) => {
    const isLast = i === history.length - 1;
    if (isLast && m.role === "user" && imageBase64) {
      const raw = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      messages.push({
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imageMediaType as "image/png" | "image/jpeg", data: raw } },
          { type: "text", text: m.content || "Match the voice in this screenshot." },
        ],
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      system: SYSTEM,
      messages,
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    let parsed: { reply: string; proposal: { prompt: string; style_profile?: Record<string, unknown> } | null } | null = null;
    try {
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      parsed = { reply: text || "Sorry, I couldn't form a response.", proposal: null };
    }
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[persona/metachat] error:", err);
    return NextResponse.json({ error: "metachat failed" }, { status: 500 });
  }
}
