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
    const { data } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    return NextResponse.json({ messages: data || [] });
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

    const systemPrompt = await buildSystemPrompt();
    const { response, actions } = await runConversationWithTools(messages, systemPrompt);

    // Save conversation (best-effort — tables may not exist yet)
    if (conversationId) {
      try {
        const userMessage = messages[messages.length - 1];
        await supabaseAdmin
          .from("chat_conversations")
          .upsert({
            id: conversationId,
            title: userMessage.content.slice(0, 80),
            updated_at: new Date().toISOString(),
          }, { onConflict: "id" });
        await supabaseAdmin.from("chat_messages").insert([
          { conversation_id: conversationId, role: "user", content: userMessage.content },
          { conversation_id: conversationId, role: "assistant", content: response },
        ]);
      } catch {
        // Chat tables may not exist yet — don't fail the response
        console.warn("Could not save chat history — tables may not exist");
      }
    }

    return NextResponse.json({
      response,
      actions,
    });
  } catch (error) {
    console.error("Chat POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed" },
      { status: 500 }
    );
  }
}
