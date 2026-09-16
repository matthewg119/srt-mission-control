export const dynamic = "force-dynamic";
// The loop is sequential and non-streaming: several Sonnet round-trips plus DB
// work per request. Every other heavy route here sets this; this one never did
// and inherited the platform default. 60 is the Hobby ceiling — raise to 300 if
// this project is on Pro.
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { isAIConfigured, buildSystemPrompt, runConversationWithTools } from "@/lib/ai";
import { supabaseAdmin } from "@/lib/db";

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");

  if (action === "conversations") {
    const { data } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, title, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return NextResponse.json({ conversations: data || [] });
  }

  if (action === "history") {
    const conversationId = request.nextUrl.searchParams.get("conversationId");
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }
    // ‼️ THE POPUP PASSES THE LITERAL STRING "chat-popup" (chat-popup.tsx), not a uuid, so this
    // read matched nothing for it and the popup opened blank every time. Mapped through
    // chat-memory, which passes a real uuid straight through and looks anything else up.
    const { findConversation } = await import("@/lib/chat-memory");
    const resolved = await findConversation(conversationId);
    if (!resolved) return NextResponse.json({ messages: [] });

    // tool_blocks is what lets a reloaded conversation keep its working
    // context. It may not exist yet (the column is added by
    // docs/2026-08-21-chat-tool-blocks.sql), so a failure here falls back to
    // the text-only history rather than blanking the conversation.
    const withBlocks = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, tool_blocks")
      .eq("conversation_id", resolved)
      .order("created_at", { ascending: true });

    let rows: unknown[] = withBlocks.data ?? [];

    if (withBlocks.error) {
      const textOnly = await supabaseAdmin
        .from("chat_messages")
        .select("role, content")
        .eq("conversation_id", resolved)
        .order("created_at", { ascending: true });
      rows = textOnly.data ?? [];
    }

    return NextResponse.json({ messages: rows });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAIConfigured()) {
      return NextResponse.json(
        {
          error: "AI_NOT_CONFIGURED",
          message:
            "Anthropic API key not configured. Add your API key in Settings > AI Configuration.",
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { messages, conversationId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const systemMsg = messages.find((m: { role: string }) => m.role === "system");
    const filteredMessages = messages.filter((m: { role: string }) => m.role !== "system");
    const systemPrompt = systemMsg
      ? (systemMsg as { content: string }).content
      : await buildSystemPrompt();
    // 10, not the shared default of 5. A lead-list question legitimately costs
    // several round-trips, and the last one is now reserved for the answer
    // itself (tool_choice: "none"), so the effective working budget is 9.
    const { response, actions, toolResults, turnBlocks } = await runConversationWithTools(
      filteredMessages,
      systemPrompt,
      undefined,
      { maxIterations: 10 }
    );

    // One writer for every surface, so a key that is not a uuid (the popup's "chat-popup") is
    // mapped rather than rejected, and a failed insert is LOGGED rather than swallowed by a catch
    // that supabase-js never reaches. See lib/chat-memory.ts.
    if (conversationId) {
      const userMessage = messages[messages.length - 1];
      const { conversationFor, saveTurn } = await import("@/lib/chat-memory");
      const resolved = await conversationFor({
        externalKey: conversationId,
        surface: "web",
        title: String(userMessage.content ?? "").slice(0, 80),
      });
      await saveTurn({
        conversationId: resolved,
        userText: String(userMessage.content ?? ""),
        assistantText: response,
        toolBlocks: turnBlocks,
      });
    }

    return NextResponse.json({
      response,
      actions,
      toolResults,
      // Sent back so the next message in this same session can replay it
      // without waiting for a reload to re-read it from the database.
      turnBlocks,
    });
  } catch (error) {
    console.error("Chat POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed" },
      { status: 500 }
    );
  }
}
