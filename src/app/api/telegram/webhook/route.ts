import { NextRequest, NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { isAIConfigured, buildSystemPrompt, runConversationWithTools } from "@/lib/ai";

export const dynamic = "force-dynamic";

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

    // Security: only allow configured user (read at runtime, not build time)
    const allowedUserId = process.env.TELEGRAM_USER_ID || "";
    if (allowedUserId && userId !== allowedUserId) {
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

    // ‼️ `telegram-${chatId}` IS NOT A uuid, AND chat_conversations.id IS ONE. Every read here
    // matched nothing and every write failed silently, so this assistant had no memory at all.
    // chat-memory maps the key to a real conversation. It also returns the LAST twenty turns: the
    // query here asked for `ascending` and got the first twenty, forever.
    const { conversationFor, loadHistory, saveTurn } = await import("@/lib/chat-memory");
    const conversationId = await conversationFor({
      externalKey: `telegram-${chatId}`,
      surface: "telegram",
      title: `Telegram: ${userText.slice(0, 60)}`,
    });
    const history = await loadHistory(conversationId);

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

    await saveTurn({ conversationId, userText, assistantText: response });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always return 200 to Telegram — otherwise it retries
    return NextResponse.json({ ok: true });
  }
}
