import { NextRequest, NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { isAIConfigured, buildSystemPrompt, runConversationWithTools } from "@/lib/ai";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";

// Telegram Update types (subset we care about)
interface TelegramUpdate {
  message?: {
    message_id: number;
    from: { id: number; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate = await request.json();
    const message = update.message;

    // Ignore non-text messages
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const userText = message.text;

    // Security: only allow configured user
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
      return NextResponse.json({ ok: true });
    }

    // Ignore commands we don't handle
    if (userText.startsWith("/start")) {
      await telegram.sendMessage(chatId, "SRT Office Manager connected. Ask me anything about your pipeline, deals, or operations.");
      return NextResponse.json({ ok: true });
    }

    if (!isAIConfigured()) {
      await telegram.sendMessage(chatId, "AI not configured. Add your Anthropic API key in Mission Control settings.");
      return NextResponse.json({ ok: true });
    }

    // Show typing indicator
    await telegram.sendTyping(chatId);

    // Load conversation history for this Telegram chat
    const conversationId = `telegram-${chatId}`;
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];

    try {
      const { data } = await supabaseAdmin
        .from("chat_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(20); // Last 20 messages for context

      if (data && data.length > 0) {
        history = data.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        }));
      }
    } catch {
      // Tables may not exist yet — continue without history
    }

    // Build messages with history + new message
    const messages = [...history, { role: "user" as const, content: userText }];

    // Run through the same AI pipeline as the dashboard
    const systemPrompt = await buildSystemPrompt();
    const { response, actions } = await runConversationWithTools(messages, systemPrompt);

    // Send response to Telegram
    let reply = response;
    if (actions.length > 0) {
      const toolSummary = actions
        .map((a) => a.split("(")[0])
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(", ");
      reply = `_[${toolSummary}]_\n\n${response}`;
    }
    await telegram.sendMessage(chatId, reply);

    // Save conversation (best-effort)
    try {
      await supabaseAdmin.from("chat_conversations").upsert(
        {
          id: conversationId,
          title: `Telegram: ${userText.slice(0, 60)}`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      await supabaseAdmin.from("chat_messages").insert([
        { conversation_id: conversationId, role: "user", content: userText },
        { conversation_id: conversationId, role: "assistant", content: response },
      ]);
    } catch {
      // Non-critical
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always return 200 to Telegram — otherwise it retries
    return NextResponse.json({ ok: true });
  }
}
