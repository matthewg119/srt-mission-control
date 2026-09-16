export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isAIConfigured } from "@/lib/ai";
import { executeTool, AI_TOOLS, type ToolExecutionResult } from "@/lib/ai-tools";
import { supabaseAdmin } from "@/lib/db";
import { getAgent } from "@/config/agents";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");
  const agentId = request.nextUrl.searchParams.get("agentId") || "alex";

  // ‼️ `agent_id` IS NOT A COLUMN ON chat_conversations, AND THIS FILTER FAILED THE WHOLE SELECT.
  // Confirmed against production 2026-09-11: the table has id, title, created_at and updated_at.
  // PostgREST rejects the query outright on the unknown name, so this list has always come back
  // empty and the Brain Trust looked like it had no history. Which agent a conversation belongs to
  // is recorded in `surface` instead, which chat-memory writes.
  if (action === "conversations") {
    const { data, error } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, title, created_at")
      .eq("surface", `brain_trust:${agentId}`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) console.error("[brain-trust] conversation list failed:", error.message);
    return NextResponse.json({ conversations: data || [] });
  }

  if (action === "history") {
    const conversationId = request.nextUrl.searchParams.get("conversationId");
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }
    const { findConversation, loadHistory } = await import("@/lib/chat-memory");
    const resolved = await findConversation(conversationId);
    return NextResponse.json({ messages: await loadHistory(resolved, 200) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAIConfigured()) {
      return NextResponse.json(
        {
          error: "AI_NOT_CONFIGURED",
          message: "Anthropic API key not configured. Add your API key in Settings > AI Configuration.",
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { messages, conversationId, agentId = "alex" } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
    }

    const agent = getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    }

    // Filter tools to only those the agent is allowed to use
    const agentTools = agent.tools.length > 0
      ? AI_TOOLS.filter((t) => agent.tools.includes(t.name))
      : [];

    const { response, toolResults } = await runAgentConversation(
      messages,
      agent.systemPrompt,
      agentTools
    );

    // Through chat-memory, like every other surface: the agent goes in `surface`, which exists,
    // rather than in `agent_id`, which does not and took the whole write down with it.
    if (conversationId) {
      const userMessage = messages[messages.length - 1];
      const { conversationFor, saveTurn } = await import("@/lib/chat-memory");
      const resolved = await conversationFor({
        externalKey: conversationId,
        surface: `brain_trust:${agentId}`,
        title: String(userMessage.content ?? "").slice(0, 80),
      });
      await saveTurn({
        conversationId: resolved,
        userText: String(userMessage.content ?? ""),
        assistantText: response,
      });
    }

    return NextResponse.json({ response, toolResults });
  } catch (error) {
    console.error("Brain Trust POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 }
    );
  }
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{
    type: string;
    tool_use_id?: string;
    content?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>;
}

async function runAgentConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  systemPrompt: string,
  tools: typeof AI_TOOLS
): Promise<{ response: string; toolResults: Array<{ tool: string; data: unknown; input: Record<string, unknown> }> }> {
  const conversationMessages: AnthropicMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const uiToolResults: Array<{ tool: string; data: unknown; input: Record<string, unknown> }> = [];
  let maxIterations = 3;

  while (maxIterations > 0) {
    maxIterations--;

    const body: Record<string, unknown> = {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: conversationMessages,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${errorText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason: string;
    };

    if (data.stop_reason === "end_turn" || data.stop_reason === "max_tokens") {
      const textContent = data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      return { response: textContent, toolResults: uiToolResults };
    }

    if (data.stop_reason === "tool_use") {
      conversationMessages.push({
        role: "assistant",
        content: data.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          return { type: "tool_use" as const, id: c.id!, name: c.name!, input: c.input! };
        }),
      });

      const claudeToolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

      for (const block of data.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          const inputPayload = block.input || {};
          const execution: ToolExecutionResult = await executeTool(block.name, inputPayload);

          claudeToolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: execution.content,
          });

          uiToolResults.push({
            tool: block.name,
            data: execution.structuredData,
            input: inputPayload,
          });
        }
      }

      conversationMessages.push({ role: "user", content: claudeToolResults });
    }
  }

  return { response: "I hit the maximum number of tool calls. Please try again.", toolResults: uiToolResults };
}
